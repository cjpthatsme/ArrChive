const express = require("express");
const cors = require("cors");
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

// MP3
const NodeID3 = require('node-id3');
// FFmpeg
const { execFile } = require('child_process');

const app = express();
const port = 5050;

const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIO_ROOT = path.resolve(__dirname, '..', 'audio-library');
const audioDataPath = path.join(ROOT_DIR, '/backend/audioData.json');
const playlistsPath = path.join(__dirname, 'playlists.json');

app.use(cors());
app.use(express.json());

// Helper: Recursively scan directory for audio files
async function scanDirectory(dir, audioExtensions) {
  let results = [];
  
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(await scanDirectory(filePath, audioExtensions));
        } else {
          const ext = path.extname(file).toLowerCase();
          if (audioExtensions.includes(ext)) {
            results.push(filePath);
          }
        }
      } catch (err) {
        // Skip files that can't be accessed
        continue;
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
    return [];
  }
  
  return results;
}


// Helper: Read extra data from JSON file
function readAudioData() {
  if (!fs.existsSync(audioDataPath)) return {};
  const raw = fs.readFileSync(audioDataPath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Helper: Write extra data to JSON file
function writeAudioData(data) {
  fs.writeFileSync(audioDataPath, JSON.stringify(data, null, 2), 'utf-8');
}

// Helper: Read playlists from JSON file
function readPlaylists() {
  if (!fs.existsSync(playlistsPath)) return [];
  const raw = fs.readFileSync(playlistsPath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Helper: Write playlists to JSON file
function writePlaylists(playlists) {
  fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2), 'utf-8');
}

// Update /api/audio-files to merge extra data
app.get('/api/audio-files/get-files', async (req, res) => {
  const targetDir = req.query.dir ? path.resolve(ROOT_DIR, req.query.dir) : path.resolve(ROOT_DIR, 'audio-library'); // default
  const audioExtensions = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a'];
  try {
    const files = await scanDirectory(targetDir, audioExtensions);
    const audioData = readAudioData();
    const fileData = await Promise.all(files.map(async (file) => {
      const relPath = toRelativeAudioPath(file);
      let metadata = {};
      try {
        const meta = await mm.parseFile(file, { duration: false });
        metadata = meta.common;
      } catch (err) {
        metadata = { error: 'Could not read metadata' };
      }
      const jsonData = audioData[relPath] || {};
      return {
        relPath, // for frontend use
        name: path.basename(file),
        metadata,
        jsonData,
      };
    }));
    res.json(fileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API route: Update extra data for a file
app.post('/api/audio-files/json/update', (req, res) => {
  const { relPath, jsonData } = req.body;
  if (!relPath) return res.status(400).json({ error: 'Missing relative path' });
  const audioData = readAudioData();
  audioData[relPath] = jsonData;
  writeAudioData(audioData);

  onAudioDataUpdate({ relPath, jsonData });

  res.json({ success: true });
});

app.post('/api/audio-files/metadata/update', async (req, res) => {
  const { relPath, metadata } = req.body;
  if (!relPath || !metadata) return res.status(400).json({ error: 'Missing data' });

  const absPath = toAbsoluteAudioPath(relPath);
  const ext = path.extname(absPath).toLowerCase();

  console.log('Metadata update request:', { relPath, metadata, absPath, ext });

  try {
    if (ext === '.mp3') {
      // MP3: node-id3
      const NodeID3 = require('node-id3');
      const tags = { 
        title: metadata.title, 
        artist: metadata.artist, 
        album: metadata.album,
        trackNumber: metadata.track ? metadata.track.toString() : undefined
      };
      console.log('Updating MP3 tags:', tags);
      const success = NodeID3.update(tags, absPath);
      if (!success) throw new Error('Failed to update MP3 tags');
    } else if (['.flac', '.wav', '.ogg', '.aac', '.m4a', '.wma'].includes(ext)) {
      // Use ffmpeg for other types
      console.log('Using ffmpeg for file type:', ext);
      await new Promise((resolve, reject) => {
        updateTagsWithFFmpeg(absPath, metadata, (err) => {
          if (err) {
            console.error('FFmpeg error:', err);
            reject(err);
          } else {
            console.log('FFmpeg update successful');
            resolve();
          }
        });
      });
    } else {
      return res.status(400).json({ error: 'Unsupported file type.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Metadata update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Audio streaming endpoint
app.get('/api/audio-files/stream', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'Missing path parameter' });

  const absPath = path.resolve(AUDIO_ROOT, relPath);
  
  // Check if file exists
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Determine content type based on file extension
  const ext = path.extname(absPath).toLowerCase();
  let contentType = 'audio/mpeg'; // default
  
  switch (ext) {
    case '.mp3':
      contentType = 'audio/mpeg';
      break;
    case '.flac':
      contentType = 'audio/flac';
      break;
    case '.wav':
      contentType = 'audio/wav';
      break;
    case '.ogg':
      contentType = 'audio/ogg';
      break;
    case '.aac':
      contentType = 'audio/aac';
      break;
    case '.m4a':
      contentType = 'audio/mp4';
      break;
    case '.wma':
      contentType = 'audio/x-ms-wma';
      break;
    default:
      contentType = 'audio/mpeg';
  }

  const stat = fs.statSync(absPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(absPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(absPath).pipe(res);
  }
});

// Playlist API endpoints
app.get('/api/playlists', (req, res) => {
  try {
    const playlists = readPlaylists();
    res.json(playlists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/playlists', (req, res) => {
  try {
    const { name, tracks = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing playlist name' });
    
    const playlists = readPlaylists();
    const newPlaylist = {
      id: Date.now(),
      name,
      tracks: tracks
    };
    playlists.push(newPlaylist);
    writePlaylists(playlists);
    
    res.json(newPlaylist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/playlists/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { tracks } = req.body;
    
    const playlists = readPlaylists();
    const playlistIndex = playlists.findIndex(p => p.id === parseInt(id));
    
    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    playlists[playlistIndex].tracks = tracks;
    writePlaylists(playlists);
    
    res.json(playlists[playlistIndex]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const playlists = readPlaylists();
    console.log(playlists);
    const filteredPlaylists = playlists.filter(p => p.id !== parseInt(id));
    writePlaylists(filteredPlaylists);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Hooks
const audioDataUpdateHooks = [
  ({ filePath, jsonData }) => {
  // Example: Log the update
  console.log(`Audio data updated for: ${filePath}`);
  // Push to this array to be called when the audio data is updated
},
]

function onAudioDataUpdate({ filePath, jsonData }) {
  // calls the array of functions in the audioDataUpdateHooks
  audioDataUpdateHooks.forEach(hook => hook({ filePath, jsonData }));
}
function toRelativeAudioPath(absPath) {
  return path.relative(AUDIO_ROOT, absPath);
}

function toAbsoluteAudioPath(relPath) {
  return path.resolve(AUDIO_ROOT, relPath);
}

function splitAbsPathAtExtension(absPath) {
  const lastDotIndex = absPath.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return ""; // No extension found
  }
  return {file: absPath.substring(0, lastDotIndex), ext: absPath.substring(lastDotIndex)};
}

function updateTagsWithFFmpeg(absPath, metadata, callback) {
  const fileLocation = splitAbsPathAtExtension(absPath);
  console.log('File location:', fileLocation);
  
  // Check if file exists
  if (!fs.existsSync(absPath)) {
    return callback(new Error(`File not found: ${absPath}`));
  }
  
  const args = [
    '-i', absPath,
    '-y',
    '-c', 'copy',
    '-map_metadata', '0',
    '-metadata', `title=${metadata.title || ''}`,
    '-metadata', `artist=${metadata.artist || ''}`,
    '-metadata', `album=${metadata.album || ''}`,
    '-metadata', `track=${metadata.track || ''}`,
    fileLocation.file + '.tmp' + fileLocation.ext 
  ];

  console.log('FFmpeg args:', args);

  execFile('ffmpeg', args, (error, stdout, stderr) => {
    if (error) {
      console.error('FFmpeg error:', error);
      console.error('FFmpeg stderr:', stderr);
      return callback(error);
    }
    
    const tempFile = fileLocation.file + '.tmp' + fileLocation.ext;
    if (!fs.existsSync(tempFile)) {
      return callback(new Error('FFmpeg did not create output file'));
    }
    
    fs.rename(tempFile, absPath, (renameError) => {
      if (renameError) {
        console.error('Rename error:', renameError);
        return callback(renameError);
      }
      console.log('File updated successfully');
      callback(null);
    });
  });
}





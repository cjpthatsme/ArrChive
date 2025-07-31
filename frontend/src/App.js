
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { uint8ArrayToBase64 } from 'uint8array-extras';


function App() {
  const [audioFiles, setAudioFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingJsonFile, setEditingJsonFile] = useState(null);
  const [editJsonData, setEditJsonData] = useState({ tags: '', notes: '' });
  const [editingFile, setEditingFile] = useState(null);
  const [editMetadata, setEditMetadata] = useState({ title: '', artist: '', album: '' });
  
  // Use refs to store current edit values without triggering re-renders
  const editMetadataRef = useRef({ title: '', artist: '', album: '' });
  const editJsonDataRef = useRef({});

  // Media player state
  const [currentPlaying, setCurrentPlaying] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  
  // Use ref for search input to avoid re-renders
  const searchInputRef = useRef('');
  
  // Playlist state
  const [playlists, setPlaylists] = useState([]);
  const [currentPlaylist, setCurrentPlaylist] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [nextAudioRef, setNextAudioRef] = useState(null);
  const [isPlaylistMode, setIsPlaylistMode] = useState(false);
  const [albumPlaylistsGenerated, setAlbumPlaylistsGenerated] = useState(false);

  useEffect(() => {
    // Fetch audio files from backend
    fetch('http://localhost:5050/api/audio-files/get-files')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        setAudioFiles(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
    
    // Load playlists from backend
    fetch('http://localhost:5050/api/playlists')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load playlists');
        return res.json();
      })
      .then((data) => {
        setPlaylists(data);
      })
      .catch((err) => {
        console.error('Error loading playlists:', err);
      });
  }, []); // Empty array = run once on mount

  // Run album playlist generation when both audio files and playlists are loaded
  useEffect(() => {
    if (audioFiles.length > 0 && playlists.length >= 0 && !albumPlaylistsGenerated) {
      console.log('Both audio files and playlists loaded, generating album playlists...');
      generateAlbumPlaylists();
    }
  }, [audioFiles, playlists, albumPlaylistsGenerated]);

  // Audio element ref
  const audioRef = useRef(null);

  // Media player functions
  const playAudio = async (file) => {
    if (currentPlaying === file.relPath && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    } else {
      setIsLoading(true);
      setCurrentPlaying(file.relPath);
      setIsPlaying(true);
      
      // Start playing after the audio element is created
      setTimeout(async () => {
        if (audioRef.current) {
          try {
            await audioRef.current.play();
            setIsLoading(false);
          } catch (error) {
            console.error('Error playing audio:', error);
            setIsLoading(false);
            setIsPlaying(false);
          }
        }
      }, 100);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    if (audioRef.current) {
      const newTime = (e.target.value / 100) * duration;
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };



  // Search functionality - only runs when search button is clicked
  const filteredAudioFiles = React.useMemo(() => {
    if (!searchQuery.trim()) return audioFiles;
    
    setIsSearching(true);
    const results = audioFiles.filter(file => {
      const query = searchQuery.toLowerCase();
      return (
        file.name.toLowerCase().includes(query) ||
        (file.metadata?.title || '').toLowerCase().includes(query) ||
        (file.metadata?.artist || '').toLowerCase().includes(query) ||
        (file.metadata?.album || '').toLowerCase().includes(query)
      );
    });
    setIsSearching(false);
    return results;
  }, [audioFiles, searchQuery]);

  const clearSearch = () => {
    setSearchQuery('');
    searchInputRef.current = '';
  };

  const performSearch = () => {
    setSearchQuery(searchInputRef.current);
  };

  const handleSearchInputChange = (e) => {
    searchInputRef.current = e.target.value;
  };

  const deletePlaylist = async (playlistId) => {
    if (!window.confirm('Are you sure you want to delete this playlist?')) {
      return;
    }
    
    try {
      const response = await fetch(`http://localhost:5050/api/playlists/${playlistId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Remove from local state
        setPlaylists(playlists.filter(p => p.id !== playlistId));
        
        // If this was the current playlist, clear it
        if (currentPlaylist && currentPlaylist.id === playlistId) {
          setCurrentPlaylist(null);
          setCurrentTrackIndex(0);
        }
      } else {
        console.error('Failed to delete playlist');
      }
    } catch (error) {
      console.error('Error deleting playlist:', error);
    }
  };

  const loadPlaylist = (playlist) => {
    setCurrentPlaylist(playlist);
    setCurrentTrackIndex(0);
  };

  const generateAlbumPlaylists = async () => {
    console.log('Starting album playlist generation...');
    console.log('Audio files count:', audioFiles.length);
    console.log('Current playlists count:', playlists.length);
    
    // Set flag to prevent duplicate runs
    setAlbumPlaylistsGenerated(true);
    
    // Group files by album
    const albumGroups = {};
    
    audioFiles.forEach(file => {
      const album = file.metadata?.album || 'Unknown Album';
      if (!albumGroups[album]) {
        albumGroups[album] = [];
      }
      albumGroups[album].push(file);
    });

    console.log('Album groups:', Object.keys(albumGroups));

    // Sort tracks within each album by track number
    Object.keys(albumGroups).forEach(album => {
      albumGroups[album].sort((a, b) => {
        const trackA = a.metadata?.track?.no || 0;
        const trackB = b.metadata?.track?.no || 0;
        return trackA - trackB;
      });
    });

    // Remove duplicate playlists first
    console.log('Removing duplicate playlists...');
    const playlistsToRemove = [];
    
    for (let i = 0; i < playlists.length; i++) {
      for (let j = i + 1; j < playlists.length; j++) {
        const playlist1 = playlists[i];
        const playlist2 = playlists[j];
        
        // Check if names and tracks are identical
        if (playlist1.name === playlist2.name && 
            JSON.stringify(playlist1.tracks) === JSON.stringify(playlist2.tracks)) {
          console.log(`Found duplicate: ${playlist1.name}`);
          playlistsToRemove.push(playlist2.id);
        }
      }
    }
    
    // Remove duplicates
    for (const playlistId of playlistsToRemove) {
      try {
        await fetch(`http://localhost:5050/api/playlists/${playlistId}`, {
          method: 'DELETE',
        });
        console.log(`🗑️ Removed duplicate playlist: ${playlistId}`);
      } catch (error) {
        console.error(`Failed to remove duplicate playlist ${playlistId}:`, error);
      }
    }

    // Refresh playlists after removing duplicates
    const refreshResponse = await fetch('http://localhost:5050/api/playlists');
    const refreshedPlaylists = await refreshResponse.json();
    setPlaylists(refreshedPlaylists);

    // Check which albums already have playlists
    const existingPlaylistNames = refreshedPlaylists.map(p => p.name);
    console.log('Existing playlist names:', existingPlaylistNames);
    
    // Create playlists for albums that don't have them
    for (const [albumName, files] of Object.entries(albumGroups)) {
      const playlistName = `Album: ${albumName}`;
      
      if (!existingPlaylistNames.includes(playlistName)) {
        console.log(`Creating playlist for: ${playlistName}`);
        try {
          // Create playlist with all tracks at once
          const tracks = files.map(file => file.relPath);
          const response = await fetch('http://localhost:5050/api/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playlistName, tracks: tracks }),
          });
          
          if (response.ok) {
            const newPlaylist = await response.json();
            console.log(`✅ Created playlist for album: ${albumName} with ${files.length} tracks`);
          } else {
            console.error(`❌ Failed to create playlist for album ${albumName}`);
          }
        } catch (error) {
          console.error(`❌ Failed to create playlist for album ${albumName}:`, error);
        }
      } else {
        console.log(`⏭️ Playlist already exists for: ${playlistName}`);
      }
    }
    
    // Final refresh of playlists
    const finalRefreshResponse = await fetch('http://localhost:5050/api/playlists');
    const finalPlaylists = await finalRefreshResponse.json();
    setPlaylists(finalPlaylists);
    
    console.log('Album playlist generation complete!');
  };

  // Playlist functions
  const createPlaylist = async (name) => {
    try {
      const response = await fetch('http://localhost:5050/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (!response.ok) throw new Error('Failed to create playlist');
      
      const newPlaylist = await response.json();
      setPlaylists([...playlists, newPlaylist]);
      return newPlaylist;
    } catch (err) {
      console.error('Error creating playlist:', err);
    }
  };

  const addToPlaylist = async (playlistId, file) => {
    try {
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) return;
      
      const updatedTracks = [...playlist.tracks, file.relPath];
      
      const response = await fetch(`http://localhost:5050/api/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: updatedTracks })
      });
      
      if (!response.ok) throw new Error('Failed to update playlist');
      
      setPlaylists(playlists.map(p => 
        p.id === playlistId 
          ? { ...p, tracks: updatedTracks }
          : p
      ));
    } catch (err) {
      console.error('Error adding to playlist:', err);
    }
  };

  const removeFromPlaylist = async (playlistId, trackIndex) => {
    try {
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) return;
      
      const updatedTracks = playlist.tracks.filter((_, index) => index !== trackIndex);
      
      const response = await fetch(`http://localhost:5050/api/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: updatedTracks })
      });
      
      if (!response.ok) throw new Error('Failed to update playlist');
      
      setPlaylists(playlists.map(p => 
        p.id === playlistId 
          ? { ...p, tracks: updatedTracks }
          : p
      ));
    } catch (err) {
      console.error('Error removing from playlist:', err);
    }
  };

  const playPlaylist = (playlist, startIndex = 0) => {
    setCurrentPlaylist(playlist);
    setCurrentTrackIndex(startIndex);
    setIsPlaylistMode(true);
    
    if (playlist.tracks[startIndex]) {
      const file = audioFiles.find(f => f.relPath === playlist.tracks[startIndex]);
      if (file) {
        playAudio(file);
      }
    }
  };

  const playNextTrack = () => {
    if (!currentPlaylist || currentTrackIndex >= currentPlaylist.tracks.length - 1) {
      // End of playlist
      setIsPlaylistMode(false);
      setCurrentPlaylist(null);
      setCurrentTrackIndex(0);
      return;
    }

    const nextIndex = currentTrackIndex + 1;
    setCurrentTrackIndex(nextIndex);
    const nextTrack = currentPlaylist.tracks[nextIndex];
    const file = audioFiles.find(f => f.relPath === nextTrack);
    
    if (file) {
      // Preload next track for gapless playback
      if (nextIndex + 1 < currentPlaylist.tracks.length) {
        const nextNextTrack = currentPlaylist.tracks[nextIndex + 1];
        const nextFile = audioFiles.find(f => f.relPath === nextNextTrack);
        if (nextFile) {
          const nextAudio = new Audio(`http://localhost:5050/api/audio-files/stream?path=${encodeURIComponent(nextFile.relPath)}`);
          nextAudio.preload = 'metadata';
          setNextAudioRef(nextAudio);
        }
      }
      
      playAudio(file);
    }
  };

  const playPreviousTrack = () => {
    if (!currentPlaylist || currentTrackIndex <= 0) return;

    const prevIndex = currentTrackIndex - 1;
    setCurrentTrackIndex(prevIndex);
    const prevTrack = currentPlaylist.tracks[prevIndex];
    const file = audioFiles.find(f => f.relPath === prevTrack);
    
    if (file) {
      playAudio(file);
    }
  };

  // Start editing JSON data
  const startEditJson = (file) => {
    setEditingJsonFile(file.relPath);
    setEditJsonData({
      tags: (file.jsonData?.tags || []).join(', '),
      notes: file.jsonData?.notes || '',
    });
  };

  // Handle changes in the JSON edit form
  const handleEditJsonChange = (e) => {
    const { name, value } = e.target;
    // Update ref immediately without triggering re-render
    editJsonDataRef.current[name] = value;
  };

  // Save JSON data
  const saveEditJson = async () => {
    try {
      const response = await fetch('http://localhost:5050/api/audio-files/json/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relPath: editingJsonFile,
          jsonData: {
            tags: editJsonData.tags.split(',').map(tag => tag.trim()).filter(Boolean),
            notes: editJsonData.notes,
          },
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save JSON data');
      }
      
      // Update local state instead of refreshing
      setAudioFiles(prevFiles => 
        prevFiles.map(file => 
          file.relPath === editingJsonFile 
            ? {
                ...file,
                jsonData: {
                  tags: editJsonData.tags.split(',').map(tag => tag.trim()).filter(Boolean),
                  notes: editJsonData.notes,
                }
              }
            : file
        )
      );
      
      setEditingJsonFile(null);
      console.log('✅ JSON data saved successfully');
      
    } catch (error) {
      console.error('❌ Error saving JSON data:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  // Find all unique JSON property keys - simplified for performance
  const jsonKeys = Array.from(
    audioFiles.reduce((keys, file) => {
      Object.keys(file.jsonData || {}).forEach((key) => keys.add(key));
      return keys;
    }, new Set())
  );

  const startEdit = (file) => {
    console.time('startEdit');
    setEditingFile(file.relPath);
    
    // Initialize refs with current values
    editMetadataRef.current = {
      title: file.metadata?.title || '',
      artist: file.metadata?.artist || '',
      album: file.metadata?.album || '',
      track: file.metadata?.track?.no || '',
      year: file.metadata?.year || '',
    };
    editJsonDataRef.current = { ...file.jsonData };
    
    // Set initial state for display
    setEditMetadata(editMetadataRef.current);
    setEditJsonData(editJsonDataRef.current);
    console.timeEnd('startEdit');
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    // Update ref immediately without triggering re-render
    editMetadataRef.current[name] = value;
  };

  const saveEdit = async () => {
    // Use ref values for saving
    const metadataToSave = editMetadataRef.current;
    const jsonDataToSave = editJsonDataRef.current;
    
    try {
      // Save metadata
      const metadataResponse = await fetch('http://localhost:5050/api/audio-files/metadata/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relPath: editingFile,
          metadata: metadataToSave,
        }),
      });
      
      if (!metadataResponse.ok) {
        throw new Error('Failed to save metadata');
      }
      
      // Save JSON data (convert comma-separated strings to arrays for array fields)
      const jsonToSave = { ...jsonDataToSave };
      jsonKeys.forEach((key) => {
        // If the original value was an array, split by comma
        if (Array.isArray(jsonDataToSave[key]) || Array.isArray(audioFiles.find(f => f.relPath === editingFile)?.jsonData?.[key])) {
          const value = jsonDataToSave[key];
          if (typeof value === 'string') {
            jsonToSave[key] = value.split(',').map(tag => tag.trim()).filter(Boolean);
          } else if (Array.isArray(value)) {
            jsonToSave[key] = value;
          } else {
            jsonToSave[key] = [];
          }
        }
      });
      
      const jsonResponse = await fetch('http://localhost:5050/api/audio-files/json/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relPath: editingFile,
          jsonData: jsonToSave,
        }),
      });
      
      if (!jsonResponse.ok) {
        throw new Error('Failed to save JSON data');
      }
      
      // Update local state instead of refreshing
      setAudioFiles(prevFiles => 
        prevFiles.map(file => 
          file.relPath === editingFile 
            ? {
                ...file,
                metadata: {
                  ...file.metadata,
                  title: metadataToSave.title || '',
                  artist: metadataToSave.artist || '',
                  album: metadataToSave.album || '',
                  track: { no: metadataToSave.track || null },
                  year: metadataToSave.year || ''
                },
                jsonData: jsonToSave
              }
            : file
        )
      );
      
      setEditingFile(null);
      console.log('✅ Metadata and JSON data saved successfully');
      
    } catch (error) {
      console.error('❌ Error saving data:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="container is-widescreen px-4">
      <div className="vid-container">
        <video playsInline autoPlay muted loop type="video/mp4" src="/img/arrchive.mp4"></video>
        <div className="vid-overlay"></div>
      </div>

      {/* Audio element */}
      {currentPlaying && (
        <audio
          ref={audioRef}
          src={`http://localhost:5050/api/audio-files/stream?path=${encodeURIComponent(currentPlaying)}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => {
            setIsPlaying(false);
            if (isPlaylistMode) {
              playNextTrack();
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onError={(e) => {
            console.error('Audio error:', e);
            console.error('Audio element:', audioRef.current);
            console.error('Current playing:', currentPlaying);
            setIsLoading(false);
            setIsBuffering(false);
          }}
        />
      )}

            {/* Player controls */}
      {currentPlaying && (
        <div className="box mb-4">
          <div className="level">
            <div className="level-left">
              <div className="level-item">
                <button 
                  className="button is-primary"
                  onClick={() => playAudio(audioFiles.find(f => f.relPath === currentPlaying))}
                  disabled={isLoading}
                >
                  {isLoading ? '⏳' : isPlaying ? '⏸️' : '▶️'}
                </button>
              </div>
              {isPlaylistMode && (
                <>
                  <div className="level-item ml-2">
                    <button 
                      className="button is-small"
                      onClick={playPreviousTrack}
                      disabled={currentTrackIndex <= 0}
                    >
                      ⏮️
                    </button>
                  </div>
                  <div className="level-item ml-2">
                    <button 
                      className="button is-small"
                      onClick={playNextTrack}
                      disabled={currentTrackIndex >= currentPlaylist.tracks.length - 1}
                    >
                      ⏭️
                    </button>
                  </div>
                </>
              )}
              <div className="level-item ml-4">
                <span className="is-size-7">
                  {isBuffering && 'Buffering... '}
                  {formatTime(currentTime)} / {formatTime(duration)}
                  {isPlaylistMode && ` (${currentTrackIndex + 1}/${currentPlaylist.tracks.length})`}
                </span>
              </div>
            </div>
            <div className="level-right">
              <div className="level-item">
                <span className="is-size-7 mr-2">🔊</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="slider"
                  style={{ width: '100px' }}
                />
              </div>
            </div>
          </div>
          <progress 
            className="progress is-primary" 
            value={(currentTime / duration) * 100 || 0} 
            max="100"
            onClick={handleSeek}
            style={{ cursor: 'pointer' }}
          />
          {isBuffering && (
            <div className="has-text-centered mt-2">
              <span className="is-size-7 has-text-grey">Buffering audio...</span>
            </div>
          )}
        </div>
      )}
      
      {/* Search Bar */}
      <div className="field has-addons mb-4">
        <div className="control is-expanded">
          <input
            className="input"
            type="text"
            placeholder="Search by name, title, artist, album, tags..."
            defaultValue=""
            onChange={handleSearchInputChange}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                performSearch();
              }
            }}
          />
        </div>
        <div className="control">
          <button 
            className="button is-primary"
            onClick={performSearch}
            disabled={!searchInputRef.current.trim()}
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="control">
          <button 
            className="button is-info"
            onClick={clearSearch}
            disabled={!searchQuery.trim()}
          >
            Clear
          </button>
        </div>
      </div>
      
      {/* Search Results Count */}
      {searchQuery.trim() && (
        <div className="notification is-info is-light mb-4">
          <p className="is-size-7">
            Found {filteredAudioFiles.length} of {audioFiles.length} files
          </p>
        </div>
      )}
      
      {/* Playlist Management */}
      <div className="columns mb-4">
        <div className="column is-4">
          <div className="box">
            <h4 className="title is-5">Playlists</h4>
            <div className="field has-addons">
              <div className="control is-expanded">
                <input
                  className="input is-small"
                  type="text"
                  placeholder="New playlist name"
                  id="newPlaylistName"
                />
              </div>
              <div className="control">
                <button 
                  className="button is-small is-info"
                  onClick={async () => {
                    const input = document.getElementById('newPlaylistName');
                    if (input.value.trim()) {
                      await createPlaylist(input.value.trim());
                      input.value = '';
                    }
                  }}
                >
                  Create
                </button>
              </div>
            </div>
            <div className="field">
              <button 
                className="button is-small is-warning"
                onClick={() => {
                  setAlbumPlaylistsGenerated(false);
                  generateAlbumPlaylists();
                }}
              >
                Generate Album Playlists
              </button>
            </div>
            <div className="content">
              {playlists.map(playlist => (
                <div key={playlist.id} className="mb-2">
                  <div className="level">
                    <div className="level-left">
                      <div className="level-item">
                        <span 
                          className="is-size-7 has-text-link" 
                          style={{ cursor: 'pointer' }}
                          onClick={() => loadPlaylist(playlist)}
                          title="Load playlist"
                        >
                          {playlist.name} ({playlist.tracks.length} tracks)
                        </span>
                      </div>
                    </div>
                    <div className="level-right">
                      <div className="level-item">
                        <button 
                          className="button is-small is-success"
                          onClick={() => playPlaylist(playlist)}
                          disabled={playlist.tracks.length === 0}
                          title="Play playlist"
                        >
                          ▶️
                        </button>
                        <button 
                          className="button is-small is-danger ml-1"
                          onClick={() => deletePlaylist(playlist.id)}
                          title="Delete playlist"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {currentPlaylist && (
          <div className="column is-8">
            <div className="box">
              <h4 className="title is-5">Current Playlist: {currentPlaylist.name}</h4>
              <div className="content">
                {currentPlaylist.tracks.map((trackPath, index) => {
                  const file = audioFiles.find(f => f.relPath === trackPath);
                  return file ? (
                    <div key={index} className={`level ${index === currentTrackIndex ? 'has-background-primary-light' : ''}`}>
                      <div className="level-left">
                        <div className="level-item">
                          <span className="is-size-7">
                            {index + 1}. {file.metadata?.title || file.name}
                          </span>
                        </div>
                      </div>
                      <div className="level-right">
                        <div className="level-item">
                          <button 
                            className="button is-small is-danger"
                            onClick={() => removeFromPlaylist(currentPlaylist.id, index)}
                          >
                            ❌
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      
      <table className="table is-bordered is-centered is-striped is-hoverable" cellPadding="8">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Title</th>
            <th>Artist</th>
            <th>Album</th>
            <th>Track</th>
            <th>Year</th>
            {jsonKeys.map((key) => (
              <th key={key}>{key.charAt(0).toUpperCase() + key.slice(1)}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredAudioFiles.map((file) => (
            <tr key={file.relPath}>
              <td>{file.name}</td>
              <td>
                {editingFile === file.relPath ? (
                  <input
                    className="nes-input"
                    name="title"
                    defaultValue={editMetadata.title}
                    onChange={handleEditChange}
                  />
                ) : (
                  file.metadata?.title || ''
                )}
              </td>
              <td>
                {editingFile === file.relPath ? (
                  <input
                    className="nes-input"
                    name="artist"
                    defaultValue={editMetadata.artist}
                    onChange={handleEditChange}
                  />
                ) : (
                  file.metadata?.artist || ''
                )}
              </td>
              <td>
                {editingFile === file.relPath ? (
                  <input
                    className="nes-input"
                    name="album"
                    defaultValue={editMetadata.album}
                    onChange={handleEditChange}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {file.metadata?.picture && file.metadata.picture[0] && (() => {
                      const picture = file.metadata.picture[0];
                      const uint8Array = new Uint8Array(picture.data.data || picture.data);
                      const base64 = btoa(Array.from(uint8Array, byte => String.fromCharCode(byte)).join(''));
                      return (
                        <img
                          src={`data:${picture.format};base64,${base64}`}
                          alt="Album Art"
                          style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                        />
                      );
                    })()}
                                      <span>{file.metadata?.album || ''}</span>
                </div>
              )}
            </td>
            <td>
              {editingFile === file.relPath ? (
                <input
                  className="nes-input"
                  name="track"
                  defaultValue={editMetadata.track}
                  onChange={handleEditChange}
                />
              ) : (
                file.metadata?.track?.no || ''
              )}
            </td>
            <td>
              {editingFile === file.relPath ? (
                <input
                  className="nes-input"
                  name="year"
                  defaultValue={editMetadata.year}
                  onChange={handleEditChange}
                />
              ) : (
                file.metadata?.year || ''
              )}
            </td>
              {jsonKeys.map((key) => (
                <td key={key}>
                  {editingFile === file.relPath ? (
                    <input
                      className="nes-input"
                      name={key}
                      defaultValue={editJsonData[key] !== undefined ? editJsonData[key] : ''}
                      onChange={handleEditJsonChange}
                    />
                  ) : Array.isArray(file.jsonData?.[key]) ? (
                    (file.jsonData[key] || []).join(', ')
                  ) : (
                    file.jsonData?.[key] || ''
                  )}
                </td>
              ))}
              <td>
                <div className="buttons are-small">
                  <button 
                    className={`button ${currentPlaying === file.relPath && isPlaying ? 'is-warning' : 'is-info'}`}
                    onClick={() => playAudio(file)}
                    disabled={isLoading && currentPlaying === file.relPath}
                    title={currentPlaying === file.relPath && isPlaying ? 'Pause' : 'Play'}
                  >
                    {isLoading && currentPlaying === file.relPath ? '⏳' : 
                     currentPlaying === file.relPath && isPlaying ? '⏸️' : '▶️'}
                  </button>
                  <div className="dropdown is-hoverable">
                    <div className="dropdown-trigger">
                      <button className="button is-small">
                        <span>📋</span>
                      </button>
                    </div>
                    <div className="dropdown-menu">
                      <div className="dropdown-content">
                        {playlists.map(playlist => (
                          <a 
                            key={playlist.id}
                            className="dropdown-item"
                            onClick={() => addToPlaylist(playlist.id, file)}
                          >
                            Add to {playlist.name}
                          </a>
                        ))}
                        {playlists.length === 0 && (
                          <div className="dropdown-item">
                            <em>No playlists yet</em>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {editingFile === file.relPath ? (
                    <>
                      <button className="handcon" onClick={saveEdit}><img src="/img/save.jpg" alt="Save" /></button>
                      <button className="handcon" onClick={() => setEditingFile(null)}><img src="/img/cancel.jpg" alt="Cancel" /></button>
                    </>
                  ) : (
                    <button className="handcon" onClick={() => startEdit(file)}><img src="/img/edit.jpg" alt="Edit" /></button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;

import { useState, useEffect, useRef } from 'react';
import { Button, message, Space, Table, Tag, Image, Tooltip, Grid, Typography, Card, Input, Dropdown, Modal, Form, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { 
  PlayCircleOutlined, 
  DeleteOutlined, 
  DownloadOutlined,
  PictureOutlined,
  LinkOutlined,
  CopyOutlined,
  PlusOutlined,
  FolderAddOutlined,
  FolderOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { BACKEND_URL } from '../config';

type VideoStatus = 'PENDING' | 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';

interface DownloadInfo {
  filename?: string;
  speed: string;
  eta: string;
  downloaded: string;
  total: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  elapsed?: number;
  progress?: number;
}

interface Video {
  id: string;
  url: string;
  title: string;
  status: VideoStatus;
  error_message?: string;
  thumbnail_url: string;
  download_info: DownloadInfo;
}

interface Playlist {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  video_count: number;
}

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatePlaylistModalVisible, setIsCreatePlaylistModalVisible] = useState(false);
  const [isVideoPlayerModalVisible, setIsVideoPlayerModalVisible] = useState(false);
  const [currentPlayingVideo, setCurrentPlayingVideo] = useState<Video | null>(null);
  const [currentPlaylist, setCurrentPlaylist] = useState<{ id: number; name: string; videos: Video[] } | null>(null);
  const [createPlaylistForm] = Form.useForm();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { Title } = Typography;
  const urlRef = useRef<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      // Try the modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        message.success('Copied to clipboard');
        return true;
      }
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        textArea.remove();
        if (successful) {
          message.success('Copied to clipboard');
          return true;
        } else {
          message.error('Failed to copy to clipboard');
          return false;
        }
      } catch (err) {
        textArea.remove();
        throw err;
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
      message.error('Failed to copy to clipboard. Please try copying manually.');
      return false;
    }
  };

  const handleClipboardPaste = async () => {
    try {
      // Try the modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text);
          return;
        }
      }
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      
      try {
        const successful = document.execCommand('paste');
        if (successful) {
          const text = textArea.value;
          textArea.remove();
          if (text) {
            setUrl(text);
            return;
          }
        }
      } catch (err) {
        textArea.remove();
        throw err;
      }
      
      message.error('Failed to read from clipboard. Please paste manually.');
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      message.error('Failed to read from clipboard. Please paste manually.');
    }
  };

  const handlePlay = (video: Video) => {
    if (video.status === 'DOWNLOADED') {
      setCurrentPlayingVideo(video);
      setCurrentPlaylist(null); // Clear playlist when playing individual video
      setIsVideoPlayerModalVisible(true);
    }
  };

  const handlePlaylistVideoClick = (video: Video) => {
    if (video.status === 'DOWNLOADED') {
      setCurrentPlayingVideo(video);
    } else {
      message.warning('This video is not ready to play yet');
    }
  };

  const handleDelete = async (videoId: string) => {
    try {
      const url = new URL(`/api/videos/${videoId}`, BACKEND_URL).toString();
      await fetch(url, {
        method: 'DELETE',
      });
      setVideos(prevVideos => prevVideos.filter(v => v.id !== videoId));
      message.success('Video deleted successfully');
    } catch (error) {
      console.error('Error deleting video:', error);
      message.error('Failed to delete video');
    }
  };

  // Playlist functions
  const fetchPlaylists = async () => {
    try {
      const response = await fetch(new URL('/api/playlists', BACKEND_URL).toString());
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data);
      }
    } catch (error) {
      console.error('Error fetching playlists:', error);
    }
  };

  const createPlaylist = async (values: { name: string; description?: string }) => {
    try {
      const response = await fetch(new URL('/api/playlists', BACKEND_URL).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      
      if (response.ok) {
        const newPlaylist = await response.json();
        setPlaylists(prev => [newPlaylist, ...prev]);
        message.success('Playlist created successfully');
        setIsCreatePlaylistModalVisible(false);
        createPlaylistForm.resetFields();
        return newPlaylist;
      } else {
        message.error('Failed to create playlist');
        return null;
      }
    } catch (error) {
      console.error('Error creating playlist:', error);
      message.error('Failed to create playlist');
      return null;
    }
  };

  const deletePlaylist = async (playlistId: number) => {
    try {
      const response = await fetch(new URL(`/api/playlists/${playlistId}`, BACKEND_URL).toString(), {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setPlaylists(prev => prev.filter(p => p.id !== playlistId));
        message.success('Playlist deleted successfully');
      } else {
        message.error('Failed to delete playlist');
      }
    } catch (error) {
      console.error('Error deleting playlist:', error);
      message.error('Failed to delete playlist');
    }
  };

  const playPlaylist = async (playlistId: number) => {
    try {
      const response = await fetch(new URL(`/api/playlists/${playlistId}`, BACKEND_URL).toString());
      if (response.ok) {
        const playlist = await response.json();
        if (playlist.videos && playlist.videos.length > 0) {
          // Set the playlist and open the first downloadable video
          setCurrentPlaylist(playlist);
          const downloadableVideo = playlist.videos.find((v: Video) => v.status === 'DOWNLOADED');
          if (downloadableVideo) {
            setCurrentPlayingVideo(downloadableVideo);
            setIsVideoPlayerModalVisible(true);
          } else {
            message.warning('No videos in this playlist are ready to play');
          }
        } else {
          message.warning('This playlist has no videos');
        }
      } else {
        message.error('Failed to load playlist');
      }
    } catch (error) {
      console.error('Error playing playlist:', error);
      message.error('Failed to play playlist');
    }
  };

  const addVideoToPlaylist = async (videoId: string, playlistId: number) => {
    try {
      const response = await fetch(new URL(`/api/videos/${videoId}/playlists`, BACKEND_URL).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playlist_id: playlistId }),
      });
      
      if (response.ok) {
        message.success('Video added to playlist successfully');
        // Refresh playlists to update video counts
        fetchPlaylists();
      } else {
        message.error('Failed to add video to playlist');
      }
    } catch (error) {
      console.error('Error adding video to playlist:', error);
      message.error('Failed to add video to playlist');
    }
  };

  const handleAddToPlaylist = async (videoId: string, playlistId: number | 'new') => {
    if (playlistId === 'new') {
      setIsCreatePlaylistModalVisible(true);
      // Store the video ID to add after playlist creation
      createPlaylistForm.setFieldsValue({ videoId });
    } else {
      await addVideoToPlaylist(videoId, playlistId as number);
    }
  };

  const handleCreatePlaylistAndAdd = async (values: { name: string; description?: string; videoId?: string }) => {
    const { videoId, ...playlistData } = values;
    const newPlaylist = await createPlaylist(playlistData);
    
    if (newPlaylist && videoId) {
      await addVideoToPlaylist(videoId, newPlaylist.id);
    }
  };

  useEffect(() => {
    const eventSources: Record<string, { es: EventSource, retryCount: number }> = {};
    const RETRY_LIMIT = 3;
    const RETRY_DELAY = 3000; 

    const setupEventSource = (videoId: string) => {
      if (eventSources[videoId]) return; 

      const sseUrl = new URL(`/api/videos/${videoId}/progress`, BACKEND_URL).toString();
      const es = new EventSource(sseUrl);
      
      eventSources[videoId] = { es, retryCount: 0 };

      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          console.log(`SSE message for video ${videoId}:`, data);
          
          if (data.event === 'progress') {
            const progressData = JSON.parse(data.data);
            
            setVideos(prev => prev.map(v => {
              if (v.id !== videoId) return v;
              
              return {
                ...v,
                download_info: {
                  ...v.download_info,
                  speed: progressData.speed || '0.0KiB/s',
                  eta: progressData.eta || '0:00',
                  downloaded: progressData.downloaded || '0.0MB',
                  total: progressData.total || '?',
                  filename: progressData.filename || ''
                }
              };
            }));
          } else if (data.event === 'complete') {
            setVideos(prev => prev.map(v => 
              v.id === videoId 
                ? { 
                    ...v, 
                    status: 'DOWNLOADED' as const,
                    download_info: {
                      ...v.download_info,
                      speed: '',
                      eta: '',
                      downloaded: v.download_info?.total || '?'
                    }
                  } 
                : v
            ));
            es.close();
          } else if (data.event === 'error') {
            setVideos(prev => prev.map(v => 
              v.id === videoId 
                ? { 
                    ...v, 
                    status: 'FAILED' as const, 
                    error_message: data.message 
                  } 
                : v
            ));
            es.close();
          }
        } catch (err) {
          console.error('Error processing SSE message:', err);
        }
      };

      const handleError = (error: Event) => {
        console.error('SSE error:', error);
        const currentRetryCount = eventSources[videoId].retryCount;
        if (currentRetryCount < RETRY_LIMIT) {
          eventSources[videoId].retryCount = currentRetryCount + 1;
          console.log(`Retrying SSE connection for video ${videoId} (${currentRetryCount + 1}/${RETRY_LIMIT}) in ${RETRY_DELAY}ms`);
          setTimeout(() => {
            setupEventSource(videoId);
          }, RETRY_DELAY);
        } else {
          console.error(`Max retries reached for video ${videoId}. Giving up.`);
        }
      };

      es.onmessage = handleMessage;
      es.onerror = handleError;
    };

    const cleanupEventSource = (videoId: string) => {
      if (eventSources[videoId]) {
        try {
          eventSources[videoId].es.close();
        } catch (e) {
          console.error(`Error closing SSE connection for video ${videoId}:`, e);
        }
        delete eventSources[videoId];
      }
    };

    videos.forEach(video => {
      if ((video.status === 'DOWNLOADING' || video.status === 'PENDING') && !eventSources[video.id]) {
        console.log(`Setting up SSE for video ${video.id} (${video.status})`);
        setupEventSource(video.id);
      }
    });
    
    Object.keys(eventSources).forEach(videoId => {
      if (!videos.some(v => v.id === videoId)) {
        console.log(`Cleaning up SSE for removed video ${videoId}`);
        cleanupEventSource(videoId);
      }
    });

    return () => {
      Object.keys(eventSources).forEach(cleanupEventSource);
    };
  }, [videos]); 

  useEffect(() => {
    fetchPlaylists();
  }, []);

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 3000; 
    let pollingTimeout: NodeJS.Timeout;
    
    console.log('HomePage mounted, setting up video polling...');
    
    const fetchVideos = async () => {
      if (!isMounted) return;
      
      try {
        setIsLoading(true);
        const url = new URL('/api/videos', BACKEND_URL).toString();
        console.log('Fetching videos from:', url);
        const startTime = Date.now();
        
        const response = await fetch(url);
        console.log(`Request completed in ${Date.now() - startTime}ms with status:`, response.status);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        console.log(`Received ${data.length} videos`);
        
        if (isMounted) {
          setVideos(data);
          retryCount = 0; 
        }
      } catch (error) {
        console.error('Error fetching videos:', error);
        
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`Retrying fetch (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY}ms`);
          pollingTimeout = setTimeout(fetchVideos, RETRY_DELAY);
          return;
        } else if (isMounted) {
          message.error('Failed to load videos after several attempts');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
      
      if (isMounted) {
        pollingTimeout = setTimeout(fetchVideos, 10000); 
      }
    };

    fetchVideos();
    
    return () => {
      console.log('HomePage unmounting, cleaning up...');
      isMounted = false;
      if (pollingTimeout) {
        clearTimeout(pollingTimeout);
      }
    };
  }, []);

  useEffect(() => {
    // Get the full URL including query parameters
    const fullUrl = window.location.href;
    console.log('Full URL:', fullUrl);
    
    // Extract the URL after the domain
    const urlObj = new URL(fullUrl);
    const path = urlObj.pathname + urlObj.search + urlObj.hash;
    console.log('Path:', path);
    
    // If there's anything after the domain, treat it as a YouTube URL
    if (path !== '/') {
      console.log('Found URL in path');
      const youtubeUrl = path.slice(1); // Remove the leading slash
      console.log('YouTube URL:', youtubeUrl);
      urlRef.current = youtubeUrl;
      handleSubmit(); // Call handleSubmit directly with the ref value
    }
  }, []); // Empty dependency array since we only want to run this once on mount

  const handleSubmit = async () => {
    const currentUrl = urlRef.current || url;
    console.log('handleSubmit called with URL:', currentUrl);
    if (!currentUrl) {
      message.error('Please enter a YouTube URL');
      return;
    }

    try {
      setIsSubmitting(true);
      console.log('Original URL:', currentUrl);
      
      const apiUrl = new URL('/api/videos', BACKEND_URL).toString();
      console.log('API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: currentUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start download');
      }

      const newVideo = await response.json();
      setVideos(prevVideos => [newVideo, ...prevVideos]);
      setUrl('');
      message.success('Download started');
      
      // Redirect to home page after successful API call
      window.location.href = '/';
    } catch (error) {
      console.error('Error:', error);
      message.error(error instanceof Error ? error.message : 'Failed to start download');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns: ColumnsType<Video> = [
    {
      title: 'Thumbnail',
      key: 'thumbnail',
      width: 180,
      render: (_, record: Video) => (
        <div style={{ padding: '8px 0', overflow: 'hidden' }}>
          {record.thumbnail_url ? (
            <Image
              src={record.thumbnail_url}
              alt="Thumbnail"
              width={180}
              height={101}
              style={{ borderRadius: '4px', objectFit: 'cover' }}
              preview={false}
            />
          ) : (
            <div style={{
              width: 180,
              height: 101,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f0f0f0',
              borderRadius: '4px'
            }}>
              <PictureOutlined style={{ fontSize: 24, color: '#999' }} />
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      // width: 400,
      ellipsis: true,
      render: (title: string) => (
        <Typography.Text ellipsis style={{ fontSize: '16px', fontWeight: '500', display: 'inline-block', verticalAlign: 'middle' }}>
          {title}
        </Typography.Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: VideoStatus, record: Video) => {
        const statusMap = {
          PENDING: { color: 'blue', text: 'PENDING' },
          DOWNLOADING: { color: 'orange', text: 'DOWNLOADING' },
          DOWNLOADED: { color: 'green', text: 'DOWNLOADED' },
          FAILED: { color: 'red', text: 'FAILED' },
        } as const;
        
        const statusInfo = statusMap[status as keyof typeof statusMap] || { color: 'default', text: status };
        
        if (status !== 'DOWNLOADING' || !record.download_info) {
          return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
        }
        
        const { filename, speed, eta, downloaded, total } = record.download_info;
        const displayName = filename ? 
          (filename.length > 15 ? `${filename.substring(0, 15)}...` : filename) : 
          'Processing...';
        
        return (
          <Tooltip 
            placement="topLeft"
            title={
              <div style={{ fontSize: '12px', lineHeight: '1.5' }}>
                <div><strong>File:</strong> {filename || 'Processing...'}</div>
                <div><strong>Downloaded:</strong> {downloaded || '0.0MB'} / {total || '?'}</div>
                <div><strong>Speed:</strong> {speed || '0.0KiB/s'}</div>
                <div><strong>ETA:</strong> {eta || '0:00'}</div>
              </div>
            }
          >
            <Tag color="orange">
              {displayName} • {speed} • {eta}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 280,
      render: (_: any, record: Video) => {
        const playlistItems = [
          {
            key: 'new',
            label: 'New Playlist',
            icon: <PlusOutlined />,
            onClick: () => handleAddToPlaylist(record.id, 'new'),
          },
          ...(playlists.length > 0 ? [{ type: 'divider' as const }] : []),
          ...playlists.map(playlist => ({
            key: playlist.id.toString(),
            label: `${playlist.name} (${playlist.video_count} videos)`,
            icon: <FolderAddOutlined />,
            onClick: () => handleAddToPlaylist(record.id, playlist.id),
          })),
        ];

        return (
          <Space>
            <Tooltip title="Play">
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => handlePlay(record)}
                disabled={record.status !== 'DOWNLOADED'}
              />
            </Tooltip>
            <Dropdown
              menu={{ items: playlistItems }}
              placement="bottomRight"
              trigger={['click']}
            >
              <Tooltip title="Add to Playlist">
                <Button
                  icon={<FolderAddOutlined />}
                  onClick={(e) => e.preventDefault()}
                />
              </Tooltip>
            </Dropdown>
            <Tooltip title="Copy Video URL">
              <Button
                icon={<LinkOutlined />}
                onClick={async () => {
                  const success = await copyToClipboard(record.url);
                  if (success) {
                    message.success('Video URL copied to clipboard');
                  } else {
                    message.error('Failed to copy URL to clipboard');
                  }
                }}
              />
            </Tooltip>
            <Tooltip title="Copy Stream URL">
              <Button
                icon={<DownloadOutlined />}
                onClick={async () => {
                  const streamUrl = new URL(`/api/videos/${record.id}/stream`, BACKEND_URL).toString();
                  const success = await copyToClipboard(streamUrl);
                  if (success) {
                    message.success('Stream URL copied to clipboard');
                  } else {
                    message.error('Failed to copy stream URL');
                  }
                }}
                title="Copy Stream URL"
              />
            </Tooltip>
            <Tooltip title="Delete">
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record.id)}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const renderCard = (video: Video) => {
    let statusColor = 'default';
    let statusText = video.status;
    
    switch (video.status) {
      case 'DOWNLOADING':
        statusColor = 'processing';
        statusText = 'DOWNLOADING';
        break;
      case 'DOWNLOADED':
        statusColor = 'success';
        statusText = 'DOWNLOADED';
        break;
      case 'FAILED':
        statusColor = 'error';
        statusText = 'FAILED';
        break;
      case 'PENDING':
        statusColor = 'warning';
        statusText = 'PENDING';
        break;
    }

    return (
      <Card 
        key={video.id}
        className="mb-4"
        cover={video.thumbnail_url ? (
          <div style={{ height: 200, overflow: 'hidden' }}>
            <Image
              src={video.thumbnail_url}
              alt="thumbnail"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              preview={false}
            />
          </div>
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }}>
            <PictureOutlined style={{ fontSize: 48, color: '#999' }} />
          </div>
        )}
      >
        <Card.Meta
          title={
            <Typography.Text ellipsis style={{ fontSize: '16px', fontWeight: 'bold' }}>
              {video.title || 'Loading...'}
            </Typography.Text>
          }
          description={
            <div>
              <div className="mb-2">
                <Tag color={statusColor}>{statusText}</Tag>
                {video.error_message && (
                  <Typography.Text type="danger" className="ml-2">
                    {video.error_message}
                  </Typography.Text>
                )}
              </div>
              <Typography.Text ellipsis type="secondary" style={{ fontSize: '14px' }}>
                {video.url}
              </Typography.Text>
              {video.download_info && video.status === 'DOWNLOADING' && (
                <div className="mt-2 text-sm text-gray-500">
                  <div>Progress: {video.download_info.progress ? Math.round(video.download_info.progress) : 0}%</div>
                  <div>Speed: {video.download_info.speed}</div>
                  <div>ETA: {video.download_info.eta}</div>
                  {video.download_info.downloaded_bytes !== undefined && video.download_info.total_bytes !== undefined && (
                    <div>Downloaded: {Math.round(video.download_info.downloaded_bytes / 1024 / 1024)}MB / {Math.round(video.download_info.total_bytes / 1024 / 1024)}MB</div>
                  )}
                </div>
              )}
            </div>
          }
        />
        <div className="mt-4 flex justify-end space-x-2">
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => handlePlay(video)}
            disabled={video.status !== 'DOWNLOADED'}
            title="Play"
          />
          <Dropdown
            menu={{
              items: [
                {
                  key: 'new',
                  label: 'New Playlist',
                  icon: <PlusOutlined />,
                  onClick: () => handleAddToPlaylist(video.id, 'new'),
                },
                ...(playlists.length > 0 ? [{ type: 'divider' as const }] : []),
                ...playlists.map(playlist => ({
                  key: playlist.id.toString(),
                  label: `${playlist.name} (${playlist.video_count} videos)`,
                  icon: <FolderAddOutlined />,
                  onClick: () => handleAddToPlaylist(video.id, playlist.id),
                })),
              ]
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Button
              icon={<FolderAddOutlined />}
              title="Add to Playlist"
            />
          </Dropdown>
          <Button
            icon={<CopyOutlined />}
            onClick={async () => {
              const success = await copyToClipboard(video.url);
              if (success) {
                message.success('URL copied to clipboard');
              } else {
                message.error('Failed to copy URL to clipboard');
              }
            }}
            title="Copy URL"
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(video.id)}
            title="Delete"
          />
        </div>
      </Card>
    );
  };

  const playlistColumns: ColumnsType<Playlist> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string) => (
        <Typography.Text ellipsis style={{ fontSize: '16px', fontWeight: '500', display: 'inline-block' }}>
          {name}
        </Typography.Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string) => (
        <Typography.Text ellipsis type="secondary" style={{ display: 'inline-block' }}>
          {description || 'No description'}
        </Typography.Text>
      ),
    },
    {
      title: 'Videos',
      dataIndex: 'video_count',
      key: 'video_count',
      width: 100,
      render: (count: number) => (
        <Tag color="blue">{count} videos</Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (date: string) => (
        <Typography.Text type="secondary">
          {new Date(date).toLocaleDateString()}
        </Typography.Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, record: Playlist) => (
        <Space>
          <Tooltip title="Play Playlist">
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => playPlaylist(record.id)}
              disabled={record.video_count === 0}
            />
          </Tooltip>
          <Tooltip title="Delete Playlist">
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => deletePlaylist(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <Title level={2} className="mb-4 sm:mb-8 text-center sm:text-left">
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            Mytube
          </a>
        </Title>
        
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm mb-4 sm:mb-8">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Enter YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={handleSubmit}
              style={{ flex: 1 }}
              size="large"
              suffix={
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => handleClipboardPaste()}
                  title="Paste from clipboard"
                />
              }
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleSubmit}
              loading={isSubmitting}
              size="large"
            >
              <span className="hidden sm:inline">Download</span>
            </Button>
          </Space.Compact>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm">
          <Tabs
            defaultActiveKey="videos"
            items={[
              {
                key: 'videos',
                label: (
                  <span>
                    <DownloadOutlined />
                    Videos ({videos.length})
                  </span>
                ),
                children: (
                  isMobile ? (
                    <div>
                      {videos.map(video => renderCard(video))}
                    </div>
                  ) : (
                    <Table
                      columns={columns}
                      dataSource={videos}
                      rowKey="id"
                      pagination={{ 
                        pageSize: 10,
                        responsive: true,
                        showSizeChanger: true,
                        showTotal: (total) => `Total ${total} items`
                      }}
                      loading={isLoading}
                    />
                  )
                ),
              },
              {
                key: 'playlists',
                label: (
                  <span>
                    <FolderOutlined />
                    Playlists ({playlists.length})
                  </span>
                ),
                children: (
                  <div>
                    <div className="mb-4 flex justify-between items-center">
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        Your Playlists
                      </Typography.Title>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setIsCreatePlaylistModalVisible(true)}
                      >
                        Create Playlist
                      </Button>
                    </div>
                    <Table
                      columns={playlistColumns}
                      dataSource={playlists}
                      rowKey="id"
                      pagination={{ 
                        pageSize: 10,
                        responsive: true,
                        showSizeChanger: true,
                        showTotal: (total) => `Total ${total} playlists`
                      }}
                      loading={isLoading}
                    />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* Create Playlist Modal */}
      <Modal
        title="Create New Playlist"
        open={isCreatePlaylistModalVisible}
        onCancel={() => {
          setIsCreatePlaylistModalVisible(false);
          createPlaylistForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={createPlaylistForm}
          layout="vertical"
          onFinish={handleCreatePlaylistAndAdd}
        >
          <Form.Item
            name="name"
            label="Playlist Name"
            rules={[{ required: true, message: 'Please enter a playlist name' }]}
          >
            <Input placeholder="Enter playlist name" />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description (Optional)"
          >
            <Input.TextArea placeholder="Enter playlist description" rows={3} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Create Playlist
              </Button>
              <Button onClick={() => {
                setIsCreatePlaylistModalVisible(false);
                createPlaylistForm.resetFields();
              }}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Video Player Modal */}
      <Modal
        title={null}
        open={isVideoPlayerModalVisible}
        onCancel={() => {
          // Stop the video before closing
          if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
          }
          setIsVideoPlayerModalVisible(false);
          setCurrentPlayingVideo(null);
          setCurrentPlaylist(null);
        }}
        footer={null}
        width={isMobile ? '95%' : currentPlaylist ? 1200 : 900}
        style={{ top: 20 }}
        bodyStyle={{ padding: 0 }}
      >
        {currentPlayingVideo && (
          <div style={{ display: 'flex', height: isMobile ? 'auto' : '600px' }}>
            {/* Playlist Sidebar */}
            {currentPlaylist && !isMobile && (
              <div style={{ 
                width: '200px', 
                borderRight: '1px solid #f0f0f0',
                overflowY: 'auto',
                backgroundColor: '#fafafa'
              }}>
                <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {currentPlaylist.name}
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                    {currentPlaylist.videos.length} videos
                  </Typography.Text>
                </div>
                <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                  {currentPlaylist.videos.map((video: Video, index: number) => (
                    <Tooltip
                      key={video.id}
                      title={video.title || 'Untitled'}
                      placement="right"
                    >
                      <div
                        onClick={() => handlePlaylistVideoClick(video)}
                        style={{
                          padding: '12px 8px',
                          cursor: video.status === 'DOWNLOADED' ? 'pointer' : 'not-allowed',
                          backgroundColor: currentPlayingVideo?.id === video.id ? '#e6f7ff' : 'transparent',
                          borderBottom: '1px solid #f0f0f0',
                          opacity: video.status === 'DOWNLOADED' ? 1 : 0.6,
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (video.status === 'DOWNLOADED') {
                            e.currentTarget.style.backgroundColor = currentPlayingVideo?.id === video.id ? '#e6f7ff' : '#f5f5f5';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (video.status === 'DOWNLOADED') {
                            e.currentTarget.style.backgroundColor = currentPlayingVideo?.id === video.id ? '#e6f7ff' : 'transparent';
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ 
                            width: '24px', 
                            height: '24px', 
                            backgroundColor: '#f0f0f0',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            color: '#666',
                            flexShrink: 0
                          }}>
                            {index + 1}
                          </div>
                          <div style={{ 
                            width: '50px', 
                            height: '40px', 
                            backgroundColor: '#f0f0f0',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            flexShrink: 0
                          }}>
                            {video.thumbnail_url ? (
                              <Image
                                src={video.thumbnail_url}
                                alt="thumbnail"
                                width={50}
                                height={40}
                                style={{ objectFit: 'cover' }}
                                preview={false}
                              />
                            ) : (
                              <div style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: '#f0f0f0'
                              }}>
                                <PictureOutlined style={{ fontSize: '16px', color: '#999' }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}
            
            {/* Video Player */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Mobile Playlist Dropdown */}
              {currentPlaylist && isMobile && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
                  <Dropdown
                    menu={{
                      items: currentPlaylist.videos.map((video: Video, index: number) => ({
                        key: video.id,
                        label: (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: '#666', minWidth: '20px' }}>
                              {index + 1}
                            </span>
                            <span style={{ 
                              fontWeight: currentPlayingVideo?.id === video.id ? 'bold' : 'normal',
                              color: video.status === 'DOWNLOADED' ? '#000' : '#999'
                            }}>
                              {video.title || 'Untitled'}
                            </span>
                          </div>
                        ),
                        disabled: video.status !== 'DOWNLOADED',
                        onClick: () => handlePlaylistVideoClick(video)
                      }))
                    }}
                    placement="bottomLeft"
                    trigger={['click']}
                  >
                    <Button style={{ width: '100%', textAlign: 'left' }}>
                      <span style={{ marginRight: '8px' }}>
                        {currentPlaylist.name} ({currentPlaylist.videos.length} videos)
                      </span>
                      <span style={{ color: '#999' }}>
                        {currentPlaylist.videos.findIndex((v: Video) => v.id === currentPlayingVideo?.id) + 1} of {currentPlaylist.videos.length}
                      </span>
                    </Button>
                  </Dropdown>
                </div>
              )}
              
              <video
                ref={videoRef}
                src={new URL(`/api/videos/${currentPlayingVideo.id}/stream`, BACKEND_URL).toString()}
                controls
                autoPlay
                style={{ 
                  width: '100%', 
                  height: isMobile ? '300px' : '500px',
                  backgroundColor: '#000'
                }}
                onError={(e) => {
                  console.error('Video playback error:', e);
                  message.error('Failed to load video. Please try again.');
                }}
              />
              <div style={{ padding: '16px' }}>
                {!currentPlaylist && (
                  <Typography.Title level={4} style={{ margin: '0 0 8px 0' }}>
                    {currentPlayingVideo.title}
                  </Typography.Title>
                )}
                <Typography.Text 
                  type="secondary" 
                  style={{ fontSize: '14px', cursor: 'pointer' }}
                  onClick={() => window.open(currentPlayingVideo.url, '_blank')}
                >
                  {currentPlayingVideo.url}
                </Typography.Text>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
} 
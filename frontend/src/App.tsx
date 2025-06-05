import { Table, Button, Input, Space, message, Typography, Image, Tag } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, CopyOutlined, DeleteOutlined, PictureOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Card } from 'antd';
import { useMediaQuery } from 'react-responsive';

const { Title } = Typography;

// Get backend URL from environment variable with fallback
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '/api';
console.log('Using BACKEND_URL:', BACKEND_URL);
console.log('Environment variables:', import.meta.env);

interface Video {
  id: string;
  url: string;
  title?: string;
  status: 'PENDING' | 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';
  error_message?: string;
  created_at?: string;
  thumbnail_url?: string;
  download_info?: {
    progress: number;
    speed: string;
    eta: string;
    total_bytes: number;
    downloaded_bytes: number;
  };
}

function App() {
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const processedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMobile = useMediaQuery({ maxWidth: 768 });
  
  function extractYouTubeUrl(href: string) {
    const index = href.lastIndexOf("https://");
    return index !== -1 ? href.substring(index) : null;
  }

  // Function to check if a string is a valid YouTube URL
  const isValidYouTubeUrl = (url: string): boolean => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    return youtubeRegex.test(url);
  };

  // Function to handle clipboard paste
  const handleClipboardPaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (isValidYouTubeUrl(clipboardText)) {
        setUrl(clipboardText);
        message.success('YouTube URL pasted from clipboard');
      }
    } catch (error) {
      console.error('Failed to read clipboard:', error);
      message.error('Could not access clipboard');
    }
  };

  // Check clipboard on component mount
  useEffect(() => {
    handleClipboardPaste();
  }, []);

  // Fetch videos on initial load
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/videos/`);
        if (!response.ok) throw new Error('Failed to fetch videos');
        const data = await response.json();
        setVideos(data);
        
        // Check if any videos are downloading
        const hasDownloading = data.some((video: Video) => video.status === 'DOWNLOADING');
        setIsDownloading(hasDownloading);
      } catch (error) {
        console.error('Error fetching videos:', error);
        message.error('Failed to fetch videos');
      }
    };
    fetchVideos();
  }, []);

  // Start polling only when downloading
  useEffect(() => {
    let isMounted = true;

    const startPolling = async () => {
      if (!isDownloading) return;

      try {
        // Get IDs of downloading videos and videos in PENDING state
        const downloadingIds = videos
          .filter(v => v.status === 'DOWNLOADING' || v.status === 'PENDING')
          .map(v => v.id);
        
        if (downloadingIds.length === 0) {
          setIsDownloading(false);
          return;
        }
        
        // Fetch each downloading video
        const updatedVideos = await Promise.all(
          downloadingIds.map(async (id) => {
            const response = await fetch(`${BACKEND_URL}/videos/${id}/`);
            if (!response.ok) throw new Error(`Failed to fetch video ${id}`);
            const data = await response.json();
            return data;
          })
        );
        
        if (!isMounted) return;

        // Update videos state with new data
        setVideos(prev => {
          const newVideos = prev.map(video => {
            const updated = updatedVideos.find(v => v.id === video.id);
            return updated || video;
          });
          
          // Check if any videos are still downloading or pending
          const stillDownloading = newVideos.some(v => 
            v.status === 'DOWNLOADING' || v.status === 'PENDING'
          );
          if (stillDownloading !== isDownloading) {
            setIsDownloading(stillDownloading);
          }
          
          return newVideos;
        });
      } catch (error) {
        console.error('Error fetching videos:', error);
      }
    };

    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    // Start polling immediately and then every 500ms
    startPolling();
    pollingIntervalRef.current = setInterval(startPolling, 500);

    // Cleanup on unmount
    return () => {
      isMounted = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isDownloading]); // Remove videos from dependency array to prevent unnecessary re-renders

  // Handle URL from path only once on initial load
  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;
    
    const href = window.location.href;
    const youtubeUrl = extractYouTubeUrl(href);
    console.log("extracted youtube url: " + youtubeUrl);
    if (youtubeUrl) {
      // Wait for download to be initiated before redirecting
      handleDownload(youtubeUrl).then(() => {
        // Redirect to root to ensure clean state
        window.location.href = '/';
      });
    }
  }, []);

  // Check for download_started parameter on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('download_started') === 'true') {
      setIsDownloading(true);
      // Remove the parameter from URL without reloading
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleDownload = async (inputUrl?: string) => {
    const urlToUse = inputUrl || url;
    if (!urlToUse) {
      message.error('Please enter a URL');
      return;
    }

    // Check if URL is already in the list
    if (videos.some(video => video.url === urlToUse)) {
      message.warning('This URL is already in the list');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/videos/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: urlToUse }),
      });

      if (!response.ok) {
        throw new Error('Failed to start download');
      }

      const data = await response.json();
      
      // Add the new video and start polling
      setVideos(prev => [...prev, data]);
      setUrl('');
      message.success('Download started');
      
      // Force polling to start by setting isDownloading to true
      setIsDownloading(true);
      
      // Immediately fetch the video status to ensure we have the latest state
      try {
        const statusResponse = await fetch(`${BACKEND_URL}/videos/${data.id}/`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setVideos(prev => prev.map(v => v.id === data.id ? statusData : v));
        }
      } catch (error) {
        console.error('Error fetching initial video status:', error);
      }
    } catch (error) {
      message.error('Failed to start download');
      console.error('Download error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/videos/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete video');
      }

      setVideos(prev => prev.filter(video => video.id !== id));
      message.success('Video deleted');
    } catch (error) {
      message.error('Failed to delete video');
      console.error('Delete error:', error);
    }
  };

  const handlePlay = (video: Video) => {
    window.open(`${BACKEND_URL}/videos/${video.id}/stream`, '_blank');
  };

  const columns: ColumnsType<Video> = [
    {
      title: 'Thumbnail',
      dataIndex: 'thumbnail_url',
      key: 'thumbnail_url',
      width: 225,
      responsive: ['md'],
      render: (url: string) => (
        <div style={{ width: 202, height: 114, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' }}>
          {url ? (
            <Image
              src={url}
              alt="thumbnail"
              width={202}
              height={114}
              style={{ objectFit: 'cover' }}
              preview={false}
            />
          ) : (
            <PictureOutlined style={{ fontSize: 32, color: '#999' }} />
          )}
        </div>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      width: '30%',
      render: (title: string) => (
        <Typography.Text ellipsis>{title || 'Loading...'}</Typography.Text>
      ),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      width: '40%',
      responsive: ['md'],
      render: (url: string) => (
        <Space>
          <Typography.Text ellipsis>{url}</Typography.Text>
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(url);
              message.success('URL copied to clipboard');
            }}
          />
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: '15%',
      render: (status: string) => {
        let color = 'default';
        let text = status;
        
        switch (status) {
          case 'DOWNLOADING':
            color = 'processing';
            text = 'Downloading';
            break;
          case 'DOWNLOADED':
            color = 'success';
            text = 'Ready';
            break;
          case 'ERROR':
            color = 'error';
            text = 'Error';
            break;
          case 'PENDING':
            color = 'warning';
            text = 'Pending';
            break;
        }
        
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '20%',
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => handlePlay(record)}
            disabled={record.status !== 'DOWNLOADED'}
            title="Play"
          />
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(record.url)
              message.success('URL copied to clipboard')
            }}
            title="Copy URL"
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
            title="Delete"
          />
        </Space>
      ),
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
                  <div>Progress: {video.download_info.progress}%</div>
                  <div>Speed: {video.download_info.speed}</div>
                  <div>ETA: {video.download_info.eta}</div>
                  <div>Downloaded: {Math.round(video.download_info.downloaded_bytes / 1024 / 1024)}MB / {Math.round(video.download_info.total_bytes / 1024 / 1024)}MB</div>
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
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(video.url);
              message.success('URL copied to clipboard');
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <Title level={2} className="mb-4 sm:mb-8 text-center sm:text-left">
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            YouTube Video Downloader
          </a>
        </Title>
        
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm mb-4 sm:mb-8">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Enter YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={() => handleDownload()}
              style={{ flex: 1 }}
              suffix={
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={handleClipboardPaste}
                  title="Paste from clipboard"
                />
              }
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload()}
              loading={loading}
            >
              <span className="hidden sm:inline">Download</span>
            </Button>
          </Space.Compact>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm">
          {isMobile ? (
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
              scroll={{ x: 'max-content' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App; 
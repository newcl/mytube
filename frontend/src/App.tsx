import { useState, useEffect, useRef } from 'react';
import { Table, Button, Input, message, Space, Typography, Progress, Tag, Image } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, DeleteOutlined, CopyOutlined, PictureOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface Video {
  id: string;
  url: string;
  status: 'PENDING' | 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';
  error?: string;
  created_at?: string;
  thumbnail_url?: string;
  download_info?: {
    progress: number;
    speed: string;
    eta: string;
    total_bytes: number;
    downloaded_bytes: number;
    elapsed: number;
  };
}

function App() {
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const processedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  function extractYouTubeUrl(href: string) {
    const index = href.lastIndexOf("https://");
    return index !== -1 ? href.substring(index) : null;
  }

  // Fetch videos on initial load
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/videos/');
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
    if (isDownloading) {
      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      // Start polling every 500ms
      pollingIntervalRef.current = setInterval(async () => {
        try {
          // Get IDs of downloading videos
          const downloadingIds = videos
            .filter(v => v.status === 'DOWNLOADING')
            .map(v => v.id);
          
          if (downloadingIds.length === 0) {
            setIsDownloading(false);
            return;
          }
          
          // Fetch each downloading video
          const updatedVideos = await Promise.all(
            downloadingIds.map(async (id) => {
              const response = await fetch(`http://localhost:8000/api/videos/${id}/`);
              if (!response.ok) throw new Error(`Failed to fetch video ${id}`);
              const data = await response.json();
              return data;
            })
          );
          
          // Update videos state with new data
          setVideos(prev => {
            const newVideos = prev.map(video => {
              const updated = updatedVideos.find(v => v.id === video.id);
              return updated || video;
            });
            
            // Check if any videos are still downloading
            const stillDownloading = newVideos.some(v => v.status === 'DOWNLOADING');
            setIsDownloading(stillDownloading);
            
            return newVideos;
          });
        } catch (error) {
          console.error('Error fetching videos:', error);
        }
      }, 500);
    } else if (pollingIntervalRef.current) {
      // Clear interval if not downloading
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [isDownloading, videos]);

  // Handle URL from path only once on initial load
  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;
    
    const href = window.location.href;
    const youtubeUrl = extractYouTubeUrl(href);
    console.log("extracted youtube url: " + youtubeUrl);
    if (youtubeUrl) {
      handleDownload(youtubeUrl);
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
      const response = await fetch('http://localhost:8000/api/videos/', {
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
      setVideos(prev => [...prev, data]);
      setUrl('');
      message.success('Download started');
      setIsDownloading(true);
      
      // Redirect to homepage if we're not already there
      if (window.location.pathname !== '/') {
        window.location.href = '/?download_started=true';
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
      const response = await fetch(`http://localhost:8000/api/videos/${id}`, {
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
    window.open(`http://localhost:8000/api/videos/${video.id}/stream`, '_blank');
  };

  const columns: ColumnsType<Video> = [
    {
      title: 'Thumbnail',
      dataIndex: 'thumbnail_url',
      key: 'thumbnail_url',
      width: 225,
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
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      width: '40%',
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
      width: '20%',
      render: (status: string, record: Video) => (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Tag color={
            status === 'DOWNLOADED' ? 'success' :
            status === 'FAILED' ? 'error' :
            status === 'DOWNLOADING' ? 'processing' :
            'default'
          }>
            {status}
          </Tag>
          {status === 'DOWNLOADING' && record.download_info && (
            <div style={{ fontSize: '12px', color: '#666' }}>
              <div>Progress: {record.download_info.progress}%</div>
              <div>Speed: {record.download_info.speed}</div>
              <div>ETA: {record.download_info.eta}</div>
              <div>Downloaded: {Math.round(record.download_info.downloaded_bytes / 1024 / 1024)}MB / {Math.round(record.download_info.total_bytes / 1024 / 1024)}MB</div>
            </div>
          )}
          {record.error && (
            <Typography.Text type="danger">{record.error}</Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Created At',
      dataIndex: 'created_at',
      key: 'created_at',
      width: '20%',
      render: (date: string) => date ? new Date(date).toLocaleString() : '-',
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
          />
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(record.url)
              message.success('URL copied to clipboard')
            }}
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <Title level={2} className="mb-8">
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            YouTube Video Downloader
          </a>
        </Title>
        
        <div className="bg-white p-6 rounded-lg shadow-sm mb-8">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Enter YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={() => handleDownload()}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload()}
              loading={loading}
            >
              Download
            </Button>
          </Space.Compact>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <Table
            columns={columns}
            dataSource={videos}
            rowKey="id"
            pagination={{ pageSize: 10 }}
          />
        </div>
      </div>
    </div>
  );
}

export default App; 
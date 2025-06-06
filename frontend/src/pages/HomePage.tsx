import { useState, useEffect, useRef } from 'react';
// No need for useNavigate here since we're using window.location for navigation
import { 
  Card, 
  Typography, 
  Input, 
  Button, 
  message, 
  Space, 
  Table, 
  Tag, 
  Image,
  Tooltip,
  Grid,
  Progress,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { 
  PlayCircleOutlined, 
  DownloadOutlined, 
  CopyOutlined, 
  DeleteOutlined,
  PictureOutlined
} from '@ant-design/icons';
import { BACKEND_URL } from '../config';

const { Title } = Typography;
const { useBreakpoint } = Grid;

interface Video {
  id: string;
  url: string;
  title?: string;
  status: 'PENDING' | 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';
  error_message?: string;
  thumbnail_url?: string;
  download_info?: {
    progress: number;
    speed: string;
    eta: string;
    total_bytes: number;
    downloaded_bytes: number;
  };
}

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const hasFetched = useRef(false);
  // EventSource is managed by useEffect, no need to store in state
  const eventSourceRef = useRef<EventSource | null>(null);


  // Setup SSE connections for each downloading video
  useEffect(() => {
    const eventSources: Record<string, { es: EventSource, retryCount: number }> = {};
    const RETRY_LIMIT = 3;
    const RETRY_DELAY = 3000; // 3 seconds

    const setupEventSource = (videoId: string) => {
      if (eventSources[videoId]) return; // Already set up

      const sseUrl = new URL(`/api/videos/${videoId}/progress`, BACKEND_URL).toString();
      const es = new EventSource(sseUrl);
      
      // Initialize retry count
      eventSources[videoId] = { es, retryCount: 0 };

      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'progress') {
            const progressData = JSON.parse(data.data);
            setVideos(prev => prev.map(v => 
              v.id === videoId ? {
                ...v,
                status: progressData.status || v.status,
                download_info: {
                  ...(v.download_info || {}),
                  progress: progressData.progress,
                  speed: progressData.speed || (v.download_info?.speed || ''),
                  eta: progressData.eta || (v.download_info?.eta || ''),
                  total_bytes: progressData.total_bytes || (v.download_info?.total_bytes || 0),
                  downloaded_bytes: progressData.downloaded_bytes || (v.download_info?.downloaded_bytes || 0)
                }
              } : v
            ));
          } else if (data.event === 'end') {
            const endData = JSON.parse(data.data);
            setVideos(prev => prev.map(v => 
              v.id === videoId ? {
                ...v,
                status: endData.status,
                error_message: endData.message || undefined
              } : v
            ));
            // Close the connection when download is complete
            cleanupEventSource(videoId);
          }
        } catch (err) {
          console.error(`Error processing SSE message for video ${videoId}:`, err);
        }
      };

      const handleError = () => {
        const currentRetryCount = eventSources[videoId]?.retryCount || 0;
        
        if (currentRetryCount < RETRY_LIMIT) {
          console.log(`Attempting to reconnect for video ${videoId} (${currentRetryCount + 1}/${RETRY_LIMIT})`);
          // Clean up the current connection
          cleanupEventSource(videoId);
          // Schedule reconnection
          setTimeout(() => setupEventSource(videoId), RETRY_DELAY * (currentRetryCount + 1));
          // Increment retry count
          if (eventSources[videoId]) {
            eventSources[videoId].retryCount = currentRetryCount + 1;
          }
        } else {
          console.error(`Max retries reached for video ${videoId}. Giving up.`);
          cleanupEventSource(videoId);
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

    // Create SSE connections for downloading/pending videos
    videos.forEach(video => {
      if ((video.status === 'DOWNLOADING' || video.status === 'PENDING') && !eventSources[video.id]) {
        setupEventSource(video.id);
      }
    });

    // Cleanup function
    return () => {
      Object.keys(eventSources).forEach(cleanupEventSource);
    };
  }, [videos]); // Re-run when videos array changes

  // Fetch videos on component mount
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    
    console.log('HomePage mounted, fetching videos...');
    
    const fetchVideos = async () => {
      const url = new URL('/api/videos', BACKEND_URL).toString();
      console.log('Fetching videos from:', url);
      const startTime = Date.now();
      
      try {
        const response = await fetch(url);
        console.log(`Request completed in ${Date.now() - startTime}ms with status:`, response.status);
        
        if (!response.ok) throw new Error('Failed to fetch videos');
        
        const data = await response.json();
        console.log('Received videos data:', { count: data.length });
        setVideos(data);
      } catch (error) {
        console.error('Error fetching videos:', error);
        message.error('Failed to load videos');
      } finally {
        setVideosLoading(false);
      }
    };

    fetchVideos();
    
    return () => {
      console.log('HomePage unmounting...');
    };
  }, []);

  const handleSubmit = async () => {
    if (!url) {
      message.error('Please enter a YouTube URL');
      return;
    }

    setLoading(true);
    try {
      const apiUrl = new URL('/api/videos', BACKEND_URL).toString();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) throw new Error('Failed to start download');

      const data = await response.json();
      message.success('Download started');
      setUrl('');
      // Update the videos list with the new download
      setVideos(prev => [data, ...prev]);
    } catch (error) {
      message.error('Failed to start download');
    } finally {
      setLoading(false);
    }
  };



  const handlePlay = (video: Video) => {
    if (video.status === 'DOWNLOADED') {
      const url = new URL(`/api/videos/${video.id}/stream`, BACKEND_URL).toString();
      window.open(url, '_blank');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const url = new URL(`/api/videos/${id}`, BACKEND_URL).toString();
      const response = await fetch(url, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete video');
      
      message.success('Video deleted');
      setVideos(prev => prev.filter(v => v.id !== id));
    } catch (error) {
      message.error('Failed to delete video');
    }
  };
  


  const copyToClipboard = async (text: string) => {
    try {
      // Try the modern clipboard API first
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (!successful) {
          throw new Error('Copy command failed');
        }
        return true;
      } catch (err) {
        console.error('Fallback copy failed:', err);
        return false;
      } finally {
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.error('Could not copy text:', err);
      return false;
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        message.success('URL pasted from clipboard');
      }
    } catch (err) {
      message.error('Failed to read from clipboard');
    }
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
      render: (url: string) => (
        <Space>
          <Typography.Text ellipsis>{url}</Typography.Text>
          <Button
            type="text"
            icon={<CopyOutlined />}
            onClick={async () => {
              const success = await copyToClipboard(url);
              if (success) {
                message.success('URL copied to clipboard');
              } else {
                message.warning('Failed to copy URL. Please try again.');
              }
            }}
          />
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 250,
      render: (status: string, record: Video) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          PENDING: { color: 'blue', text: 'Pending' },
          DOWNLOADING: { color: 'orange', text: 'Downloading' },
          DOWNLOADED: { color: 'green', text: 'Downloaded' },
          FAILED: { color: 'red', text: 'Failed' },
        };
        const statusInfo = statusMap[status] || { color: 'default', text: status };
        
        if (status === 'DOWNLOADING' && record.download_info) {
          const { progress, speed, eta } = record.download_info;
          return (
            <div>
              <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
              <div style={{ marginTop: 4 }}>
                <Progress 
                  percent={Math.round((progress || 0) * 100)} 
                  size="small" 
                  showInfo={false}
                />
                <div style={{ fontSize: 12, color: '#666' }}>
                  {Math.round((progress || 0) * 100)}% • {speed} • ETA: {eta}
                </div>
              </div>
            </div>
          );
        }
        
        return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '20%',
      render: (_: any, record: Video) => (
        <Space>
          <Tooltip title="Play">
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handlePlay(record)}
              disabled={record.status !== 'DOWNLOADED'}
            />
          </Tooltip>
          <Tooltip title="Copy Stream URL">
            <Button
              icon={<CopyOutlined />}
              onClick={async () => {
                const streamUrl = new URL(`/api/videos/${record.id}/stream`, BACKEND_URL).toString();
                try {
                  if (navigator.clipboard) {
                    await navigator.clipboard.writeText(streamUrl);
                  } else {
                    // Fallback for browsers that don't support clipboard API
                    const textArea = document.createElement('textarea');
                    textArea.value = streamUrl;
                    textArea.style.position = 'fixed';
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                  }
                  message.success('Stream URL copied to clipboard');
                } catch (err) {
                  console.error('Failed to copy URL:', err);
                  message.error('Failed to copy URL to clipboard');
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
                  <div>Progress: {Math.round(video.download_info.progress)}%</div>
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
              onPressEnter={handleSubmit}
              style={{ flex: 1 }}
              size="large"
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
              onClick={handleSubmit}
              loading={loading}
              size="large"
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
              loading={videosLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
} 
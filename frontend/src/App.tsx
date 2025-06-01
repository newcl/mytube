import { useState, useEffect, useRef } from 'react';
import { Table, Button, Input, Modal, message, Space, Typography, Image, Badge, Tooltip, Progress } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, DeleteOutlined, SearchOutlined, ClockCircleOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, CopyOutlined, PictureOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface Video {
  id: number;
  title?: string | null;
  thumbnail_url?: string | null;
  status: string;
  created_at: string;
  file_path?: string | null;
  file_size?: number | null;
  url: string;
  error_message?: string | null;
  download_info?: {
    progress: number;
    speed: string;
    eta: string;
    total_bytes: number;
    downloaded_bytes: number;
    elapsed: number;
  } | null;
}

function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [searchText, setSearchText] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchVideos = async () => {
    try {
      console.log('Fetching videos...');
      const response = await fetch('http://localhost:8000/api/videos/');
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Received data:', data);
      setVideos(data);
    } catch (error) {
      console.error('Error fetching videos:', error);
      message.error('Failed to fetch videos');
    }
  };

  // Start polling if there are downloading videos
  useEffect(() => {
    const hasDownloadingVideos = videos.some(video => video.status === 'DOWNLOADING');
    
    if (hasDownloadingVideos) {
      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      // Start polling every 500ms
      pollingIntervalRef.current = setInterval(fetchVideos, 500);
    } else if (pollingIntervalRef.current) {
      // Clear interval if no downloading videos
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [videos]);

  useEffect(() => {
    fetchVideos();
    
    // Set up WebSocket connection
    const ws = new WebSocket('ws://localhost:8000/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      console.log('Received:', event.data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  const handleDownload = async () => {
    if (!url) {
      message.warning('Please enter a YouTube URL');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/videos/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const data = await response.json();
      message.success('Download started successfully');
      setUrl('');
      fetchVideos();
    } catch (error) {
      console.error('Error downloading video:', error);
      message.error('Failed to download video');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`http://localhost:8000/api/videos/${id}/`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Delete failed');
      }

      message.success('Video deleted successfully');
      fetchVideos();
    } catch (error) {
      console.error('Error deleting video:', error);
      message.error('Failed to delete video');
    }
  };

  const handlePlay = (video: Video) => {
    setSelectedVideo(video);
    setIsModalVisible(true);
  };

  useEffect(() => {
    if (isModalVisible && videoRef.current) {
      videoRef.current.play().catch(error => {
        console.error('Error attempting to auto-play:', error);
        // Handle potential Autoplay Policy restrictions
      });
    } else if (!isModalVisible && videoRef.current) {
        // Pause and reset video and remove source when modal is closed
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        videoRef.current.src = ''; // Explicitly remove source
    }
  }, [isModalVisible]); // Rerun effect when modal visibility changes

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DOWNLOADED':
        return 'success';
      case 'FAILED':
        return 'error';
      case 'DOWNLOADING':
        return 'processing';
      case 'PENDING':
          return 'default'; // Or 'warning' or 'processing'
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
      switch (status) {
          case 'PENDING':
              return <ClockCircleOutlined style={{ color: getStatusColor(status) }} />;
          case 'DOWNLOADING':
              return <LoadingOutlined style={{ color: getStatusColor(status) }} />;
          case 'DOWNLOADED':
              return <CheckCircleOutlined style={{ color: getStatusColor(status) }} />;
          case 'FAILED':
              return <CloseCircleOutlined style={{ color: getStatusColor(status) }} />;
          default:
              return null;
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
      width: 150,
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <Typography.Text ellipsis={true}>
            {text}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 200,
      render: (status: string, record: Video) => {
        if (status === 'DOWNLOADING' && record.download_info) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LoadingOutlined style={{ color: getStatusColor(status) }} />
                <span>Downloading</span>
              </div>
              <Progress
                percent={record.download_info.progress}
                size="small"
                status="active"
              />
              <div style={{ fontSize: '12px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                {record.download_info?.speed && record.download_info.speed !== 'N/A' && record.download_info.speed !== 'unknown' && (
                  <span>{record.download_info.speed}</span>
                )}
                {record.download_info?.eta && record.download_info.eta !== 'N/A' && record.download_info.eta !== 'unknown' && (
                  <span>{record.download_info.eta}</span>
                )}
              </div>
            </div>
          );
        } else {
          return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Tooltip title={status}>
                {getStatusIcon(status)}
              </Tooltip>
            </div>
          );
        }
      },
    },
    {
      title: 'Created At',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
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
              navigator.clipboard.writeText(record.url);
              message.success('URL copied to clipboard');
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

  const filteredVideos = videos.filter(video =>
    (video.title?.toLowerCase() || '').includes(searchText.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <Title level={2} className="mb-8">YouTube Video Downloader</Title>
        
        <div className="bg-white p-6 rounded-lg shadow-sm mb-8">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Enter YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPressEnter={handleDownload}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              loading={loading}
            >
              Download
            </Button>
          </Space.Compact>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="mb-4">
            <Input
              placeholder="Search videos..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 300 }}
            />
          </div>
          
          <Table
            columns={columns}
            dataSource={filteredVideos}
            rowKey="id"
            pagination={{ pageSize: 10 }}
          />
        </div>

        <Modal
          title={selectedVideo?.title}
          open={isModalVisible}
          onCancel={() => setIsModalVisible(false)}
          footer={null}
          width={800}
        >
          {selectedVideo && (
            <video
              ref={videoRef}
              controls
              style={{ width: '100%' }}
              src={`http://localhost:8000/api/videos/${selectedVideo.id}/stream/`}
            />
          )}
        </Modal>
      </div>
    </div>
  );
}

export default App; 
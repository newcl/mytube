import { useState, useEffect, useRef } from 'react';
import { Table, Button, Input, Modal, message, Space, Typography, Image, Badge, Tooltip, Progress } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, DeleteOutlined, SearchOutlined, ClockCircleOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface Video {
  id: number;
  title?: string | null;
  thumbnail_url: string;
  status: string;
  created_at: string;
  file_path?: string;
  download_progress?: number | null;
}

function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [searchText, setSearchText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchVideos = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/videos/');
      const data = await response.json();
      setVideos(data);
    } catch (error) {
      console.error('Error fetching videos:', error);
      message.error('Failed to fetch videos');
    }
  };

  useEffect(() => {
    fetchVideos();
    const interval = setInterval(fetchVideos, 5000);
    return () => clearInterval(interval);
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
      minWidth: 180,
      render: (url: string) => (
        <Image
          src={url}
          alt="thumbnail"
          width={160}
          height={90}
          style={{ objectFit: 'cover' }}
          preview={false}
        />
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      minWidth: 300,
      ellipsis: true,
      render: (text: string) => (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Typography.Text ellipsis={true}>
            {text}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string, record: Video) => {
        if (status === 'DOWNLOADING' && record.download_progress != null) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%' }}>
              <Progress
                percent={record.download_progress}
                size="small"
                status={record.download_progress === 100 ? 'success' : 'active'}
              />
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
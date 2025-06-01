import { useState, useEffect } from 'react';
import { Table, Button, Input, message, Space, Typography, Progress, Tag } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface Video {
  id: string;
  url: string;
  status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  error?: string;
  created_at?: string;
}

function App() {
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);

  // Load videos from localStorage on initial render
  useEffect(() => {
    const savedVideos = localStorage.getItem('videos');
    if (savedVideos) {
      setVideos(JSON.parse(savedVideos));
    }
  }, []);

  // Save videos to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('videos', JSON.stringify(videos));
  }, [videos]);

  // Handle URL from path only once on initial load
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/http')) {
      const youtubeUrl = path.substring(1); // Remove leading slash
      if (youtubeUrl.includes('youtube.com') || youtubeUrl.includes('youtu.be')) {
        handleDownload(youtubeUrl);
      }
    }
  }, []); // Empty dependency array means this runs once on mount

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
            status === 'COMPLETED' ? 'success' :
            status === 'FAILED' ? 'error' :
            status === 'DOWNLOADING' ? 'processing' :
            'default'
          }>
            {status}
          </Tag>
          {status === 'DOWNLOADING' && record.progress !== undefined && (
            <Progress percent={record.progress} size="small" />
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
            disabled={record.status !== 'COMPLETED'}
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
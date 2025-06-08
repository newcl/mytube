import { useState, useEffect } from 'react';
import { Button, message, Space, Table, Tag, Image, Tooltip, Grid, Typography, Card, Input } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { 
  PlayCircleOutlined, 
  DeleteOutlined, 
  DownloadOutlined,
  PictureOutlined,
  LinkOutlined,
  CopyOutlined
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

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { Title } = Typography;

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('Copied to clipboard');
      return true;
    } catch (err) {
      console.error('Failed to copy text: ', err);
      message.error('Failed to copy to clipboard');
      return false;
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      message.error('Failed to read from clipboard');
    }
  };

  const handlePlay = (video: Video) => {
    if (video.status === 'DOWNLOADED') {
      const streamUrl = new URL(`/api/videos/${video.id}/stream`, BACKEND_URL).toString();
      window.open(streamUrl, '_blank');
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

  const testUrlExtraction = () => {
    const testCases = [
      'http://lhmswww.com/https://www.youtube.com/watch?v=dJgIV5spSA0&t=646s',
      'http://lhmswww.com/youtube.com/watch?v=dJgIV5spSA0',
      'http://lhmswww.com/watch?v=dJgIV5spSA0',
      'http://lhmswww.com/https://youtu.be/dJgIV5spSA0',
      'http://lhmswww.com/youtu.be/dJgIV5spSA0'
    ];

    console.log('=== Testing URL extraction with lhmswww.com prefix ===');
    testCases.forEach(testUrl => {
      const extracted = extractYouTubeUrl(testUrl);
      console.log(`Input: ${testUrl}`);
      console.log(`Extracted: ${extracted}`);
      console.log('---');
    });
    console.log('=== Test complete ===');
  };

  // Run test immediately
  testUrlExtraction();

  useEffect(() => {
    testUrlExtraction();
  }, []);

  const extractYouTubeUrl = (inputUrl: string): string => {
    try {
      // If the URL contains another URL after the domain, extract it
      const urlParts = inputUrl.split('/');
      
      // Find the index where the YouTube URL starts
      const youtubeUrlIndex = urlParts.findIndex(part => 
        part.includes('youtube.com') || 
        part.includes('youtu.be') ||
        part.includes('watch?v=')
      );
      
      if (youtubeUrlIndex !== -1) {
        // Reconstruct the YouTube URL
        const extractedUrl = urlParts.slice(youtubeUrlIndex).join('/');
        
        // If it's just a video ID, construct a proper YouTube URL
        if (extractedUrl.startsWith('watch?v=')) {
          return `https://www.youtube.com/${extractedUrl}`;
        }
        
        // Ensure the URL starts with http:// or https://
        if (!extractedUrl.startsWith('http')) {
          return `https://${extractedUrl}`;
        }
        return extractedUrl;
      }
      
      // If no YouTube URL found, try to find a URL pattern
      const urlPattern = /(https?:\/\/[^\s]+)/;
      const match = inputUrl.match(urlPattern);
      if (match) {
        return match[1];
      }
      
      return inputUrl;
    } catch (error) {
      console.error('Error extracting YouTube URL:', error);
      return inputUrl;
    }
  };

  const handleSubmit = async () => {
    if (!url) {
      message.error('Please enter a YouTube URL');
      return;
    }

    try {
      setIsSubmitting(true);
      console.log('Original URL:', url);
      const youtubeUrl = extractYouTubeUrl(url);
      console.log('Extracted YouTube URL:', youtubeUrl);
      
      const apiUrl = new URL('/api/videos', BACKEND_URL).toString();
      console.log('API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start download');
      }

      const newVideo = await response.json();
      setVideos(prevVideos => [newVideo, ...prevVideos]);
      setUrl('');
      message.success('Download started');
      window.location.href = '/';  // Redirect to home page
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
      width: 120,
      render: (_, record: Video) => (
        <div style={{ padding: '8px 0' }}>
          {record.thumbnail_url ? (
            <Image
              src={record.thumbnail_url}
              alt="Thumbnail"
              width={120}
              height={68}
              style={{ borderRadius: '4px', objectFit: 'cover' }}
              preview={false}
            />
          ) : (
            <div style={{
              width: 120,
              height: 68,
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
      render: (title: string) => (
        <Typography.Text ellipsis style={{ fontSize: '16px', fontWeight: '500' }}>
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
              loading={isLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
} 
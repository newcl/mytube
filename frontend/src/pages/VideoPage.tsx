import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Typography, Progress, Button, Space, message, Image } from 'antd';
import { PlayCircleOutlined, ReloadOutlined, PictureOutlined } from '@ant-design/icons';
import { BACKEND_URL } from '../config';

const { Title, Text } = Typography;

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

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const fetchVideo = async () => {
    try {
      const url = new URL(`/api/videos/${id}`, BACKEND_URL).toString();
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch video');
      }
      const data = await response.json();
      setVideo(data);
      setError(null);
    } catch (err) {
      setError('Failed to load video');
      message.error('Failed to load video');
    } finally {
      setLoading(false);
    }
  };

  // Setup SSE connection for progress updates
  useEffect(() => {
    if (!id) return;
    
    const eventSource = new EventSource(new URL(`/api/videos/${id}/progress`, BACKEND_URL).toString());
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.event === 'progress') {
          const progressData = JSON.parse(data.data);
          setProgress(progressData.progress);
          
          // Update video state with progress
          setVideo(prev => prev ? {
            ...prev,
            status: progressData.status.toUpperCase(),
            download_info: {
              ...(prev.download_info || {}),
              progress: progressData.progress,
              speed: progressData.speed,
              eta: progressData.eta,
              total_bytes: progressData.total_bytes,
              downloaded_bytes: progressData.downloaded_bytes
            }
          } : prev);
        } else if (data.event === 'end') {
          const endData = JSON.parse(data.data);
          // Final update and close connection
          setVideo(prev => prev ? {
            ...prev,
            status: endData.status.toUpperCase(),
            error_message: endData.message || undefined
          } : prev);
          eventSource.close();
        } else if (data.event === 'error') {
          const errorData = JSON.parse(data.data);
          setError(errorData.message || 'An error occurred');
          eventSource.close();
        }
      } catch (err) {
        console.error('Error processing SSE message:', err);
      }
    };
    
    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      eventSource.close();
    };
    
    // Initial fetch
    fetchVideo();
    
    return () => {
      eventSource.close();
    };
  }, [id]);

  const handleRetry = async () => {
    try {
      const url = new URL(`/api/videos/${id}/retry`, BACKEND_URL).toString();
      const response = await fetch(url, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to retry download');
      message.success('Download restarted');
      fetchVideo();
    } catch (err) {
      message.error('Failed to retry download');
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

  const handlePlay = () => {
    const url = new URL(`/api/videos/${id}/stream`, BACKEND_URL).toString();
    window.open(url, '_blank');
  };

  const handleCopyUrl = async () => {
    if (!video) return;
    const success = await copyToClipboard(video.url);
    if (success) {
      message.success('URL copied to clipboard');
    } else {
      message.warning('Failed to copy URL. Please try again.');
    }
  };

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  if (error || !video) {
    return (
      <div className="p-8">
        <Title level={2}>Error</Title>
        <Text type="danger">{error || 'Video not found'}</Text>
        <div className="mt-4">
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <Card>
          <div className="mb-4">
            <Title level={2}>{video.title || 'Loading...'}</Title>
            <Text type="secondary" className="block mb-4">
              {video.url}
            </Text>
          </div>

          {video.thumbnail_url ? (
            <div className="mb-4">
              <Image
                src={video.thumbnail_url}
                alt="thumbnail"
                style={{ width: '100%', maxHeight: '400px', objectFit: 'contain' }}
                preview={false}
              />
            </div>
          ) : (
            <div className="mb-4 h-64 flex items-center justify-center bg-gray-100">
              <PictureOutlined style={{ fontSize: 48, color: '#999' }} />
            </div>
          )}

          {video.status === 'DOWNLOADING' && video.download_info && (
            <div className="mb-4">
              <Progress
                percent={progress || video.download_info?.progress || 0}
                status={video.status === 'FAILED' ? 'exception' : 'active'}
                format={(percent) => `${percent}%`}
              />
              <div className="text-sm text-gray-500">
                <div>Speed: {video.download_info.speed}</div>
                <div>ETA: {video.download_info.eta}</div>
                <div>
                  Downloaded: {Math.round(video.download_info.downloaded_bytes / 1024 / 1024)}MB / 
                  {Math.round(video.download_info.total_bytes / 1024 / 1024)}MB
                </div>
              </div>
            </div>
          )}

          {video.status === 'FAILED' && (
            <div className="mb-4">
              <Text type="danger">{video.error_message || 'Download failed'}</Text>
            </div>
          )}

          <Space>
            {video.status === 'DOWNLOADED' && (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handlePlay}
              >
                Play Video
              </Button>
            )}
            {video.status === 'FAILED' && (
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRetry}
              >
                Retry Download
              </Button>
            )}
            <Button onClick={handleCopyUrl}>
              Copy URL
            </Button>
            <Button onClick={() => navigate('/')}>
              Back to Home
            </Button>
          </Space>
        </Card>
      </div>
    </div>
  );
} 
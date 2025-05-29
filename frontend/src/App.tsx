import { useState, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { Progress } from './components/ui/progress'
import { Alert, AlertDescription } from './components/ui/alert'
import { AlertCircle, Download, ExternalLink, Play, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table"

interface Video {
  id: number
  url: string
  title?: string
  status: string
  error_message?: string
  thumbnail_url?: string
  file_path?: string
  file_size?: number
  created_at: string
}

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [videos, setVideos] = useState<Video[]>([])
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')

  const fetchVideos = async () => {
    try {
      const res = await fetch('/api/videos/')
      if (!res.ok) throw new Error('Failed to fetch videos')
      const data = await res.json()
      console.log('Fetched videos:', data)
      setVideos(data)
    } catch (err) {
      setError('Failed to fetch videos')
    }
  }

  useEffect(() => {
    fetchVideos()
    const interval = setInterval(fetchVideos, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/videos/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })

      if (!response.ok) {
        throw new Error('Failed to start download')
      }

      const data = await response.json()
      console.log('Download started:', data)
      setUrl('')
      fetchVideos()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DOWNLOADED':
        return 'bg-green-500'
      case 'FAILED':
        return 'bg-red-500'
      case 'DOWNLOADING':
        return 'bg-blue-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-12 px-4">
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Header Section */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">YouTube Video Downloader</h1>
              <p className="mt-2 text-muted-foreground">Download and manage your YouTube videos</p>
            </div>
            <Button variant="outline" onClick={() => window.open('https://github.com/yourusername/mytube', '_blank')}>
              <ExternalLink className="w-4 h-4 mr-2" />
              GitHub
            </Button>
          </div>

          {/* Download Form Section */}
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl">Download New Video</CardTitle>
              <CardDescription>Enter a YouTube URL to start downloading</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Input
                    type="url"
                    placeholder="Enter YouTube URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                    className="w-full h-12 text-lg"
                  />
                  {error && (
                    <Alert variant="destructive" className="mt-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>
                
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-lg"
                >
                  {loading ? (
                    <>
                      <Download className="w-5 h-5 mr-2 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5 mr-2" />
                      Download Video
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Videos Section */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold tracking-tight">Your Videos</h2>
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground">
                  {videos.length} {videos.length === 1 ? 'video' : 'videos'} in your library
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant={viewMode === 'cards' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('cards')}
                  >
                    Cards
                  </Button>
                  <Button
                    variant={viewMode === 'table' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('table')}
                  >
                    Table
                  </Button>
                </div>
              </div>
            </div>

            {videos.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-48">
                  <div className="text-center space-y-2">
                    <p className="text-muted-foreground text-lg">No videos yet</p>
                    <p className="text-sm text-muted-foreground">Start by downloading your first video!</p>
                  </div>
                </CardContent>
              </Card>
            ) : viewMode === 'cards' ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {videos.map(video => (
                  <Card key={video.id} className="flex flex-col">
                    <div className="relative bg-black/5 flex items-center justify-center p-2">
                      <div style={{ width: '200px', height: '112px' }} className="relative">
                        {video.thumbnail_url ? (
                          <div className="absolute inset-0 overflow-hidden">
                            <img 
                              src={video.thumbnail_url} 
                              alt={video.title || 'Video thumbnail'} 
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-muted-foreground text-xs">No thumbnail</span>
                          </div>
                        )}
                        <Badge 
                          className={`absolute top-1 right-1 ${getStatusColor(video.status)} text-[10px] px-1 py-0`}
                        >
                          {video.status}
                        </Badge>
                        {video.status === 'DOWNLOADED' && video.file_path && (
                          <Button 
                            variant="secondary"
                            size="icon"
                            className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                            onClick={() => {
                              if (!video.file_path) return;
                              try {
                                const videoUrl = `http://localhost:8000/downloads/${video.file_path.replace('downloads/', '')}`;
                                const videoElement = document.createElement('video');
                                videoElement.src = videoUrl;
                                videoElement.controls = true;
                                videoElement.className = 'w-full h-full object-contain';
                                
                                const button = document.querySelector(`[data-video-id="${video.id}"]`);
                                if (button) {
                                  const container = button.parentElement;
                                  if (container) {
                                    container.innerHTML = '';
                                    container.appendChild(videoElement);
                                    videoElement.play();
                                  }
                                }
                              } catch (error) {
                                console.error('Error opening video:', error);
                              }
                            }}
                            data-video-id={video.id}
                          >
                            <Play className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 flex flex-col gap-2">
                      <h3 className="text-sm font-medium truncate">
                        {video.title || video.url}
                      </h3>
                      {video.status === 'DOWNLOADING' && (
                        <div>
                          <Progress value={33} className="w-full h-1" />
                          <p className="text-xs text-muted-foreground">Downloading...</p>
                        </div>
                      )}
                      {video.status === 'FAILED' && video.error_message && (
                        <p className="text-xs text-destructive truncate">{video.error_message}</p>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => window.open(video.url, '_blank')}
                        className="w-full hover:bg-gray-100 h-7 text-xs"
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        View on YouTube
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[50%] py-2">Title</TableHead>
                        <TableHead className="w-[10%] py-2">Status</TableHead>
                        <TableHead className="w-[10%] py-2">Size</TableHead>
                        <TableHead className="w-[15%] py-2">Created</TableHead>
                        <TableHead className="w-[15%] py-2 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {videos.map(video => (
                        <TableRow key={video.id} className="group hover:bg-gray-50">
                          <TableCell className="py-2">
                            <div className="flex items-center gap-2">
                              <div style={{ width: '160px', height: '90px' }} className="relative bg-black/5 flex-shrink-0">
                                {video.thumbnail_url ? (
                                  <div className="absolute inset-0 overflow-hidden">
                                    <img 
                                      src={video.thumbnail_url} 
                                      alt={video.title || 'Video thumbnail'} 
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                  </div>
                                ) : (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-muted-foreground text-xs">No thumbnail</span>
                                  </div>
                                )}
                                {video.status === 'DOWNLOADED' && video.file_path && (
                                  <Button 
                                    variant="secondary"
                                    size="icon"
                                    className="absolute inset-0 m-auto w-6 h-6 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                                    onClick={() => {
                                      if (!video.file_path) return;
                                      try {
                                        const videoUrl = `http://localhost:8000/downloads/${video.file_path.replace('downloads/', '')}`;
                                        const videoElement = document.createElement('video');
                                        videoElement.src = videoUrl;
                                        videoElement.controls = true;
                                        videoElement.className = 'w-full h-full object-contain';
                                        
                                        const button = document.querySelector(`[data-video-id="${video.id}"]`);
                                        if (button) {
                                          const container = button.parentElement;
                                          if (container) {
                                            container.innerHTML = '';
                                            container.appendChild(videoElement);
                                            videoElement.play();
                                          }
                                        }
                                      } catch (error) {
                                        console.error('Error opening video:', error);
                                      }
                                    }}
                                    data-video-id={video.id}
                                  >
                                    <Play className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-medium truncate">
                                  {video.title || video.url}
                                </h3>
                                {video.status === 'DOWNLOADING' && (
                                  <div>
                                    <Progress value={33} className="w-full h-1" />
                                    <p className="text-xs text-muted-foreground">Downloading...</p>
                                  </div>
                                )}
                                {video.status === 'FAILED' && video.error_message && (
                                  <p className="text-xs text-destructive truncate">{video.error_message}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge className={`${getStatusColor(video.status)} text-[10px] px-1 py-0`}>
                              {video.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 text-xs">
                            {video.file_size ? `${(video.file_size / (1024 * 1024)).toFixed(1)} MB` : '-'}
                          </TableCell>
                          <TableCell className="py-2 text-xs">
                            {new Date(video.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(video.url, '_blank')}
                                className="hover:bg-gray-100 h-7 text-xs"
                              >
                                <ExternalLink className="w-3 h-3 mr-1" />
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

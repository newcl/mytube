import React, { useEffect, useState } from "react";
import { Spin, Typography } from "antd";

const { Title } = Typography;

export default function App() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fullUrl = window.location.href;
    const backendBase = "http://localhost:8000";
    

    const encodedPath = fullUrl.slice(window.location.origin.length+1);
    const backendUrl = `${backendBase}/${encodeURIComponent(encodedPath)}`;

    // Start loading
    setVideoSrc(backendUrl);
  }, []);

  const handleCanPlay = () => {
    setLoading(false);
  };

  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <Title level={3}>MyTube Player</Title>

      {loading && (
        <div style={{ marginTop: 50 }}>
          <Spin tip="Downloading and preparing video..." size="large" />
        </div>
      )}

      {videoSrc && (
        <video
          src={videoSrc}
          controls
          autoPlay
          onCanPlay={handleCanPlay}
          style={{ width: "100%", maxWidth: "960px", marginTop: 30 }}
        >
          Your browser does not support HTML5 video.
        </video>
      )}
    </div>
  );
}

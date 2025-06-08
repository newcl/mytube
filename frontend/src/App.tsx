import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import VideoPage from './pages/VideoPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/videos/:id" element={<VideoPage />} />
        <Route path="/https://www.youtube.com/watch?v=:id" element={<HomePage />} />
        <Route path="/https://youtu.be/:id" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App; 
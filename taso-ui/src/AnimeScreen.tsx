import { useEffect, useState } from 'react';

export default function AnimeScreen() {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageUrl = 'https://cdn.jsdelivr.net/gh/iamkhan/animemes@latest/character.png'; // placeholder anime image

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => setImageLoaded(true);
  }, []);

  return (
    <section className="anime-screen" aria-label="Anime Character Screen">
      <header className="anime-header">
        <h2>Anime Character</h2>
        <p>Enjoy a touch of anime in your workspace.</p>
      </header>
      <div className="anime-content">
        {imageLoaded ? (
          <img src={imageUrl} alt="Anime character" className="anime-image" />
        ) : (
          <p>Loading character…</p>
        )}
      </div>
    </section>
  );
}

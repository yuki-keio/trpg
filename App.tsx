
import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Character, ScenarioOutline, Reward } from './types';
import { GameState } from './types';
import { CharacterCreationScreen } from './components/CharacterCreationScreen';
import { GamePlayScreen } from './components/GamePlayScreen';
import { GameClearScreen } from './components/GameClearScreen';
import { GameOverScreen } from './components/GameOverScreen';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { generateScenarioOutline } from './services/keeperAI';
import { ScenarioOptionsModal } from './components/ScenarioOptionsModal';

const BGMPlayer: React.FC = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // This useEffect handles cleanup when the component unmounts.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []); // Empty dependency array means this cleanup runs only on unmount.

  const togglePlay = () => {

    if (!audioRef.current) {
      const audio = new Audio('/carol_bgm.mp3');
      audio.loop = true;
      audio.volume = 0.2;
      // When the audio is paused via controls or code, update our state.
      audio.onpause = () => setIsPlaying(false);
      // When the audio is played, update our state.
      audio.onplay = () => setIsPlaying(true);
      audioRef.current = audio;
    }

    const audio = audioRef.current;

    // The state might not be perfectly in sync if played/paused from outside our button,
    // so we check the 'paused' property of the audio element itself.
    if (audio.paused) {
      audio.play().catch(error => {
        console.error("Audio play failed:", error);
        // If play fails, we reset the audioRef to allow a re-initialization on the next click.
        // This handles cases where the audio element enters a bad state.
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        // Ensure our state is correct.
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  };

  return (
    <button
      onClick={togglePlay}
      className="fixed bottom-4 right-4 z-[100] w-12 h-12 bg-gray-800/80 text-white rounded-full flex items-center justify-center shadow-lg border border-purple-500/30 backdrop-blur-sm hover:bg-purple-700/80 transition-colors"
      aria-label={isPlaying ? "BGMを停止" : "BGMを再生"}
    >
      {isPlaying ? <Volume2 size={24} /> : <VolumeX size={24} />}
    </button>
  );
};

const LoadingScreen: React.FC<{ text: string }> = ({ text }) => (
  <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center text-white z-[200]">
    <Loader2 className="w-16 h-16 animate-spin text-purple-400 mb-6" />
    <h1 className="text-3xl font-crimson mb-2">{text}</h1>
    <p className="text-gray-400">物語の準備をしています...</p>
  </div>
);


export default function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.CharacterCreation);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenario, setScenario] = useState<ScenarioOutline | null>(null);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [isScenarioOptionsModalOpen, setScenarioOptionsModalOpen] = useState(false);

  const handleCharacterCreationSubmit = (newCharacters: Character[]) => {
    setCharacters(newCharacters);
    setScenarioOptionsModalOpen(true);
  };

  const handleGenerateScenario = useCallback(async (options: { playTime?: string; difficulty?: string; synopsis?: string; }) => {
    setScenarioOptionsModalOpen(false);
    setGameState(GameState.GeneratingScenario);

    try {
      const generatedScenario = await generateScenarioOutline(characters, options);
      setScenario(generatedScenario);
      setGameState(GameState.Playing);
    } catch (error) {
      console.error("Failed to generate scenario:", error);
      // Handle error, maybe show an error message and return to character creation
      setGameState(GameState.CharacterCreation);
      alert("シナリオの生成に失敗しました。もう一度お試しください。");
    }
  }, [characters]);

  const handleGameClear = useCallback((finalRewards: Reward[] | null) => {
    setRewards(finalRewards);
    setGameState(GameState.GameClear);
  }, []);

  const handleGameOver = useCallback(() => {
    setGameState(GameState.GameOver);
  }, []);

  const handleRestart = useCallback(() => {
    setCharacters([]);
    setScenario(null);
    setRewards(null);
    setGameState(GameState.CharacterCreation);
  }, []);

  const renderContent = () => {
    switch (gameState) {
      case GameState.CharacterCreation:
        return <CharacterCreationScreen onCharacterCreate={handleCharacterCreationSubmit} />;
      case GameState.GeneratingScenario:
        return <LoadingScreen text="シナリオを生成中" />;
      case GameState.Playing:
        return characters.length > 0 && scenario ? (
          <GamePlayScreen
            initialCharacters={characters}
            initialScenario={scenario}
            onGameClear={handleGameClear}
            onGameOver={handleGameOver}
          />
        ) : (
          // Fallback to CharacterCreationScreen if something is missing
          <CharacterCreationScreen onCharacterCreate={handleCharacterCreationSubmit} />
        );
      case GameState.GameClear:
        return scenario ? (
          <GameClearScreen
            scenarioTitle={scenario.title}
            rewards={rewards}
            onRestart={handleRestart}
          />
        ) : <CharacterCreationScreen onCharacterCreate={handleCharacterCreationSubmit} />; // Fallback
      case GameState.GameOver:
        return scenario ? (
          <GameOverScreen
            scenarioTitle={scenario.title}
            onRestart={handleRestart}
          />
        ) : <CharacterCreationScreen onCharacterCreate={handleCharacterCreationSubmit} />; // Fallback
      default:
        return <div>不明なゲーム状態です</div>;
    }
  };

  return (
    <div className="App">
      <BGMPlayer />
      {renderContent()}
      <ScenarioOptionsModal
        isOpen={isScenarioOptionsModalOpen}
        onClose={() => setScenarioOptionsModalOpen(false)}
        onGenerate={handleGenerateScenario}
      />
    </div>
  );
}

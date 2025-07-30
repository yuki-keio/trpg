
import React from 'react';
import { Skull, RefreshCw } from 'lucide-react';

interface GameOverScreenProps {
  scenarioTitle: string;
  onRestart: () => void;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({ scenarioTitle, onRestart }) => {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex items-center justify-center p-4 bg-cover bg-center" style={{backgroundImage: "url('https://images.unsplash.com/photo-1549611399-27d49f168d71?q=80&w=1920&auto=format&fit=crop')"}}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm"></div>
      <div className="relative z-10 bg-gray-800/80 p-6 sm:p-8 rounded-lg shadow-2xl border border-red-500/30 max-w-2xl w-full text-center animate-fade-in">
        <Skull size={64} className="mx-auto text-red-400 mb-4 drop-shadow-[0_0_15px_rgba(248,113,113,0.5)]" />
        <h1 className="text-4xl sm:text-5xl font-bold font-crimson text-red-300 mb-2">ゲームオーバー</h1>
        <p className="text-gray-300 mb-8">あなたたちの物語は、ここで悲劇的な結末を迎えました。</p>
        
        <div className="bg-gray-900/50 p-6 rounded-lg mb-8 text-left">
          <h2 className="text-2xl font-crimson text-gray-400 mb-4">挑戦したシナリオ</h2>
          <p className="text-xl font-semibold text-gray-300">{scenarioTitle}</p>
        </div>

        <button 
          onClick={onRestart}
          className="px-8 py-3 bg-red-700 hover:bg-red-600 text-white font-bold text-lg rounded-md transition-all transform hover:scale-105 shadow-lg flex items-center mx-auto"
        >
          <RefreshCw className="mr-3" />
          もう一度挑戦する
        </button>
      </div>
      <style>{`
        @keyframes fade-in {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in {
            animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
};

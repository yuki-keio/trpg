
import React from 'react';
import type { Reward } from '../types';
import { Award, Gift, RefreshCw } from 'lucide-react';

interface GameClearScreenProps {
  scenarioTitle: string;
  rewards: Reward[] | null;
  onRestart: () => void;
}

export const GameClearScreen: React.FC<GameClearScreenProps> = ({ scenarioTitle, rewards, onRestart }) => {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex items-center justify-center p-4 bg-cover bg-center" style={{backgroundImage: "url('https://images.unsplash.com/photo-1528459139293-5595436a287a?q=80&w=1920&auto=format&fit=crop')"}}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div className="relative z-10 bg-gray-800/80 p-6 sm:p-8 rounded-lg shadow-2xl border border-yellow-500/30 max-w-3xl w-full text-center animate-fade-in">
        <Award size={64} className="mx-auto text-yellow-400 mb-4 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]" />
        <h1 className="text-4xl sm:text-5xl font-bold font-crimson text-yellow-300 mb-2">シナリオクリア！</h1>
        <p className="text-gray-300 mb-8">おめでとうございます！あなたたちは無事に生還しました。</p>
        
        <div className="bg-gray-900/50 p-6 rounded-lg mb-8 text-left">
          <h2 className="text-2xl font-crimson text-purple-300 mb-4">クリアしたシナリオ</h2>
          <p className="text-xl font-semibold">{scenarioTitle}</p>
        </div>

        {rewards && rewards.length > 0 && (
          <div className="bg-gray-900/50 p-6 rounded-lg mb-8 text-left">
            <h2 className="text-2xl font-crimson text-purple-300 mb-4 flex items-center">
              <Gift size={24} className="mr-3" />
              獲得した報酬
            </h2>
            <ul className="space-y-4">
              {rewards.map((reward, index) => (
                <li key={index} className="border-l-4 border-purple-400 pl-4 py-1">
                  <h3 className="font-bold text-lg text-purple-200">{reward.name}</h3>
                  <p className="text-gray-300">{reward.effect}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button 
          onClick={onRestart}
          className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg rounded-md transition-all transform hover:scale-105 shadow-lg flex items-center mx-auto"
        >
          <RefreshCw className="mr-3" />
          タイトルに戻る
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

import React, { useState, useEffect, useRef } from 'react';
import { parseAndRoll, rollDie } from '../utils/dice';

interface DiceRollModalProps {
    isOpen: boolean;
    notation: string;
    reason: string;
    onRollComplete: (result: number) => void;
}

export const DiceRollModal: React.FC<DiceRollModalProps> = ({
    isOpen,
    notation,
    reason,
    onRollComplete,
}) => {
    const [isRolling, setIsRolling] = useState(false);
    const [displayValue, setDisplayValue] = useState<string>('...');
    const intervalRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);

    const getRandomFlickerValue = (notation: string) => {
        if (notation.includes('d100')) return rollDie(100);
        if (notation.includes('d20')) return rollDie(20);
        if (notation.includes('d12')) return rollDie(12);
        if (notation.includes('d10')) return rollDie(10);
        if (notation.includes('d8')) return rollDie(8);
        if (notation.includes('d6')) return rollDie(6);
        if (notation.includes('d4')) return rollDie(4);
        return rollDie(100); // fallback
    };
    
    useEffect(() => {
        if (isOpen) {
            setIsRolling(true);
            setDisplayValue('...');
            const finalResult = parseAndRoll(notation);

            intervalRef.current = window.setInterval(() => {
                setDisplayValue(getRandomFlickerValue(notation).toString());
            }, 70);

            timeoutRef.current = window.setTimeout(() => {
                if (intervalRef.current) clearInterval(intervalRef.current);
                setIsRolling(false);
                setDisplayValue(finalResult.toString());

                timeoutRef.current = window.setTimeout(() => {
                    onRollComplete(finalResult);
                }, 1200);

            }, 2000);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isOpen, notation, onRollComplete]);

    if (!isOpen) return null;

    const keyframes = `
        @keyframes roll-in {
            from { transform: translateY(20px) scale(0.8); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .animate-roll-in {
            animation: roll-in 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
    `;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[200]">
            <style>{keyframes}</style>
            <div className="bg-gray-900/80 border border-purple-500/30 rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center text-white font-sans animate-roll-in">
                <h2 className="text-2xl font-bold font-crimson text-purple-300 mb-2">{reason}</h2>
                <p className="text-gray-400 mb-8 text-lg">({notation})</p>

                <div className="flex justify-center items-center h-48">
                    <div className="w-48 h-48 bg-gray-800/50 border-4 border-purple-500 rounded-full flex items-center justify-center relative overflow-hidden">
                        <span className={`font-bold font-mono transition-all duration-200 ${isRolling ? 'text-7xl text-purple-400/75 animate-pulse' : 'text-9xl text-white drop-shadow-[0_0_15px_rgba(192,132,252,0.6)]'}`}>
                            {displayValue}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

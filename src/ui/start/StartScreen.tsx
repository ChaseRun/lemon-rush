// PLACEHOLDER: the start-screen agent replaces this with a pixel-art title screen.
export interface StartScreenProps {
  onStart: () => void;
  onRules: () => void;
}

export function StartScreen({ onStart, onRules }: StartScreenProps) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>🍋 Lemon Rush</h1>
      <button onClick={onStart}>Start summer</button> <button onClick={onRules}>Rules</button>
    </div>
  );
}

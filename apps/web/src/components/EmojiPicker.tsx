const EMOJIS = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😘',
  '😎',
  '🤔',
  '😴',
  '👍',
  '👎',
  '👏',
  '🙏',
  '💪',
  '🔥',
  '🎉',
  '✅',
  '❌',
  '⚠️',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '⭐',
  '🚀',
  '📌',
  '📎',
  '😅',
  '😉',
  '🙌',
  '👋',
  '🤝',
  '💬',
  '📞',
  '📷',
  '🎁',
  '💰',
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="emoji-pop">
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="emoji-btn" onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders coach text safely as React elements (never as HTML): paragraphs, "- " bullet lists and
 * **bold** spans, which is all the coach is asked to use.
 */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

export function MessageText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="grid gap-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
        return bullets ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs
          <ul key={i} className="list-disc space-y-1 pl-5">
            {lines.map((l, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static lines
              <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs
          <p key={i} className="whitespace-pre-line">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

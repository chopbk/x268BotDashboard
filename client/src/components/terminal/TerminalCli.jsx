import { useEffect, useMemo, useRef, useState } from "react";
import { parseCli, suggestCli } from "./cli.js";

export default function TerminalCli({ onSubmit, selectedAccount, disabled }) {
  const [input, setInput] = useState("");
  const [log, setLog] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => suggestCli(input), [input]);

  useEffect(() => {
    setActive(0);
  }, [input]);

  function pushLog(line, kind = "info") {
    setLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, line, kind }, ...prev].slice(0, 6));
  }

  async function run(raw) {
    const text = String(raw || input).trim();
    if (!text) return;
    const parsed = parseCli(text, { selectedAccount });
    if (!parsed.ok) {
      pushLog(parsed.error, "error");
      return;
    }
    if (parsed.action?.type === "help") {
      pushLog(parsed.message, "help");
      setInput("");
      return;
    }
    try {
      const result = await onSubmit?.(parsed.action, text);
      if (result?.message) pushLog(result.message, result.ok === false ? "error" : "ok");
      else pushLog(text, "ok");
      setInput("");
    } catch (err) {
      pushLog(err.message || "Lỗi CLI", "error");
    }
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === "Tab" && suggestions[active]) {
      e.preventDefault();
      setInput(`${suggestions[active].insert} `);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[active] && input.split(/\s+/).length <= 1) {
        setInput(`${suggestions[active].insert} `);
        return;
      }
      run();
    }
  }

  return (
    <div className="term-cli" aria-label="CLI lệnh nhanh">
      <div className="term-cli-row">
        <span className="term-cli-prompt">›</span>
        <input
          ref={inputRef}
          value={input}
          disabled={disabled}
          spellCheck={false}
          placeholder="/help · /cl 50% · /o BTCUSDT LONG 1% · /ai"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-controls="term-cli-suggest"
        />
        <button type="button" className="ghost" disabled={disabled || !input.trim()} onClick={() => run()}>Gửi</button>
      </div>
      {suggestions.length && input.startsWith("/") ? (
        <ul id="term-cli-suggest" className="term-cli-suggest" role="listbox">
          {suggestions.map((item, idx) => (
            <li key={item.label}>
              <button
                type="button"
                className={idx === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(`${item.insert} `);
                  inputRef.current?.focus();
                }}
              >
                <code>{item.label}</code>
                <span className="muted">{item.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {log.length ? (
        <ul className="term-cli-log">
          {log.map((item) => (
            <li key={item.id} className={`term-cli-log-${item.kind}`}>
              <pre>{item.line}</pre>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

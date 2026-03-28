import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  action?: string | null;
  data?: any;
  timestamp: Date;
}

export default function Agent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: ++nextId.current,
      role: "user",
      text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await api.sendAgentMessage(text);
      const agentMsg: ChatMessage = {
        id: ++nextId.current,
        role: "agent",
        text: res.data.reply,
        action: res.data.action,
        data: res.data.data,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: ++nextId.current,
        role: "agent",
        text: `Error: ${err.message || "Failed to send message"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-xl font-semibold">Agent</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Natural language interface to nightcode
          </p>
        </div>
        <div className="text-right">
          <code className="text-xs bg-zinc-800 border border-zinc-700 px-2 py-1 rounded text-zinc-400 font-mono">
            POST /api/agent
          </code>
          <p className="text-xs text-zinc-600 mt-1">
            Use your auth token for external access
          </p>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-zinc-500 text-sm mb-2">
                Tell the agent what to do
              </p>
              <p className="text-zinc-600 text-xs">
                Examples: "Create a task to fix the login bug in repo X" or "What tasks are running?"
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-4 py-3 ${
                msg.role === "user"
                  ? "bg-blue-900/40 border border-blue-800/50 text-blue-100"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-200"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              {msg.action && (
                <div className="mt-2 pt-2 border-t border-zinc-700/50">
                  <span className="text-xs text-zinc-500">Action: </span>
                  <span className="text-xs text-zinc-400 font-mono">{msg.action}</span>
                </div>
              )}
              {msg.data && msg.action === "task_created" && msg.data.taskId && (
                <div className="mt-2">
                  <Link
                    to={`/tasks/${msg.data.taskId}`}
                    className="inline-flex items-center gap-1.5 text-xs bg-blue-900/30 border border-blue-800/50 text-blue-300 hover:text-blue-200 hover:bg-blue-900/40 px-2 py-1 rounded transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    View Task #{msg.data.taskId}
                  </Link>
                </div>
              )}
              {msg.data && msg.action !== "task_created" && (
                <details className="mt-2">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
                    Show details
                  </summary>
                  <pre className="text-xs text-zinc-500 font-mono mt-1 overflow-x-auto">
                    {JSON.stringify(msg.data, null, 2)}
                  </pre>
                </details>
              )}
              <p className="text-xs text-zinc-600 mt-1">
                {msg.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="animate-pulse">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="mt-3 flex gap-2 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command..."
          disabled={loading}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}

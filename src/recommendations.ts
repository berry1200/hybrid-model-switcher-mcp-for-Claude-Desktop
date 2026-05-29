import type { ModelRecommendation } from "./types.js";

export const MODEL_RECOMMENDATIONS: ModelRecommendation[] = [
  {
    taskType: "reasoning",
    displayName: "DeepSeek R1",
    modelName: "deepseek-r1:latest",
    reason: "Best fit for heavy reasoning and long-form analysis.",
    ollamaPull: "ollama pull deepseek-r1",
  },
  {
    taskType: "coding",
    displayName: "DeepSeek Coder",
    modelName: "deepseek-coder:latest",
    reason: "Specialized for code generation and refactoring tasks.",
    ollamaPull: "ollama pull deepseek-coder",
  },
  {
    taskType: "balanced",
    displayName: "Qwen3",
    modelName: "qwen3:latest",
    reason: "Balanced general-purpose local assistant behavior.",
    ollamaPull: "ollama pull qwen3",
  },
  {
    taskType: "chat",
    displayName: "Llama 3.1",
    modelName: "llama3.1:latest",
    reason: "Good general chat behavior and broad model availability.",
    ollamaPull: "ollama pull llama3.1",
  },
  {
    taskType: "fast",
    displayName: "Phi-4",
    modelName: "phi4:latest",
    reason: "Useful for lightweight, lower-latency local tasks.",
    ollamaPull: "ollama pull phi4",
  },
];

export function recommendModel(taskType: string): ModelRecommendation {
  const normalized = taskType.trim().toLowerCase();
  return (
    MODEL_RECOMMENDATIONS.find(
      (item) =>
        item.taskType === normalized ||
        item.displayName.toLowerCase() === normalized ||
        item.modelName.toLowerCase().startsWith(normalized),
    ) ?? MODEL_RECOMMENDATIONS[2]
  );
}


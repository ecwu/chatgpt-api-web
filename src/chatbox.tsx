import { createRef } from "preact";
import { StateUpdater, useEffect, useState } from "preact/hooks";
import type { ChatStore } from "./app";
import ChatGPT, {
  calculate_token_length,
  ChunkMessage,
  FetchResponse,
} from "./chatgpt";
import Message from "./message";
import models from "./models";
import Settings from "./settings";

export default function ChatBOX(props: {
  chatStore: ChatStore;
  setChatStore: (cs: ChatStore) => void;
  selectedChatIndex: number;
  setSelectedChatIndex: StateUpdater<number>;
}) {
  const { chatStore, setChatStore } = props;
  // prevent error
  if (chatStore === undefined) return <div></div>;
  const [inputMsg, setInputMsg] = useState("");
  const [showGenerating, setShowGenerating] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState("");
  const [showRetry, setShowRetry] = useState(false);

  const messagesEndRef = createRef();
  useEffect(() => {
    console.log("ref", messagesEndRef);
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [showRetry, showGenerating, generatingMessage]);

  const client = new ChatGPT(chatStore.apiKey);

  const _completeWithStreamMode = async (response: Response) => {
    chatStore.streamMode = true;
    // call api, return reponse text
    console.log("response", response);
    const reader = response.body?.getReader();
    const allChunkMessage: string[] = [];
    new ReadableStream({
      async start() {
        while (true) {
          let responseDone = false;
          let state = await reader?.read();
          let done = state?.done;
          let value = state?.value;
          if (done) break;
          let text = new TextDecoder().decode(value);
          // console.log("text:", text);
          const lines = text
            .trim()
            .split("\n")
            .map((line) => line.trim())
            .filter((i) => {
              if (!i) return false;
              if (i === "data: [DONE]") {
                responseDone = true;
                return false;
              }
              return true;
            });
          console.log("lines", lines);
          const jsons: ChunkMessage[] = lines
            .map((line) => {
              return JSON.parse(line.trim().slice("data: ".length));
            })
            .filter((i) => i);
          console.log("jsons", jsons);
          for (const { model } of jsons) {
            if (model) chatStore.responseModelName = model;
          }
          const chunkText = jsons
            .map((j) => j.choices[0].delta.content ?? "")
            .join("");
          // console.log("chunk text", chunkText);
          allChunkMessage.push(chunkText);
          setShowGenerating(true);
          setGeneratingMessage(allChunkMessage.join(""));
          if (responseDone) break;
        }
        setShowGenerating(false);

        // console.log("push to history", allChunkMessage);
        const content = allChunkMessage.join("");
        const token = calculate_token_length(content);
        // estimate cost
        if (chatStore.responseModelName) {
          chatStore.cost +=
            token * models[chatStore.responseModelName].price.completion;
          let sum = 0;
          for (const msg of chatStore.history
            .filter(({ hide }) => !hide)
            .slice(chatStore.postBeginIndex)) {
            sum += msg.token;
          }
          chatStore.cost +=
            sum * models[chatStore.responseModelName].price.prompt;
        }
        chatStore.history.push({
          role: "assistant",
          content,
          hide: false,
          token,
        });
        // manually copy status from client to chatStore
        chatStore.maxTokens = client.max_tokens;
        chatStore.tokenMargin = client.tokens_margin;
        setChatStore({ ...chatStore });
        setGeneratingMessage("");
        setShowGenerating(false);
      },
    });
  };

  const _completeWithFetchMode = async (response: Response) => {
    chatStore.streamMode = false;
    const data = (await response.json()) as FetchResponse;
    chatStore.responseModelName = data.model ?? "";
    if (data.model) {
      chatStore.cost +=
        (data.usage.prompt_tokens ?? 0) * models[data.model].price.prompt;
      chatStore.cost +=
        (data.usage.completion_tokens ?? 0) *
        models[data.model].price.completion;
    }
    const content = client.processFetchResponse(data);
    chatStore.history.push({
      role: "assistant",
      content,
      hide: false,
      token: data.usage.completion_tokens ?? calculate_token_length(content),
    });
    setShowGenerating(false);
  };

  // wrap the actuall complete api
  const complete = async () => {
    // manually copy status from chatStore to client
    client.apiEndpoint = chatStore.apiEndpoint;
    client.sysMessageContent = chatStore.systemMessageContent;
    client.tokens_margin = chatStore.tokenMargin;
    client.messages = chatStore.history
      .slice(chatStore.postBeginIndex)
      // only copy non hidden message
      .filter(({ hide }) => !hide)
      // only copy content and role attribute to client for posting
      .map(({ content, role }) => {
        return {
          content,
          role,
        };
      });
    client.model = chatStore.model;
    client.max_tokens = chatStore.maxTokens;

    // todo move code
    const max = chatStore.maxTokens - chatStore.tokenMargin;
    let sum = 0;
    chatStore.postBeginIndex = chatStore.history.filter(
      ({ hide }) => !hide
    ).length;
    for (const msg of chatStore.history.slice().reverse()) {
      sum += msg.token;
      if (sum > max) break;
      chatStore.postBeginIndex -= 1;
    }
    chatStore.postBeginIndex =
      chatStore.postBeginIndex < 0 ? 0 : chatStore.postBeginIndex;

    try {
      setShowGenerating(true);
      const response = await client._fetch(chatStore.streamMode);
      const contentType = response.headers.get("content-type");
      if (contentType === "text/event-stream") {
        await _completeWithStreamMode(response);
      } else if (contentType === "application/json") {
        await _completeWithFetchMode(response);
      } else {
        throw `unknown response content type ${contentType}`;
      }
      // manually copy status from client to chatStore
      chatStore.maxTokens = client.max_tokens;
      chatStore.tokenMargin = client.tokens_margin;
      chatStore.totalTokens = client.total_tokens;

      // todo move code
      const max = chatStore.maxTokens - chatStore.tokenMargin;
      let sum = 0;
      chatStore.postBeginIndex = chatStore.history.filter(
        ({ hide }) => !hide
      ).length;
      for (const msg of chatStore.history.slice().reverse()) {
        sum += msg.token;
        if (sum > max) break;
        chatStore.postBeginIndex -= 1;
      }
      chatStore.postBeginIndex =
        chatStore.postBeginIndex < 0 ? 0 : chatStore.postBeginIndex;

      console.log("postBeginIndex", chatStore.postBeginIndex);
      setChatStore({ ...chatStore });
    } catch (error) {
      setShowRetry(true);
      alert(error);
    } finally {
      setShowGenerating(false);
      props.setSelectedChatIndex(props.selectedChatIndex);
    }
  };

  // when user click the "send" button or ctrl+Enter in the textarea
  const send = async (msg = "") => {
    const inputMsg = msg;
    if (!inputMsg) {
      console.log("empty message");
      return;
    }
    chatStore.responseModelName = "";
    chatStore.history.push({
      role: "user",
      content: inputMsg.trim(),
      hide: false,
      token: calculate_token_length(inputMsg.trim()),
    });
    // manually calculate token length
    chatStore.totalTokens += client.calculate_token_length(inputMsg.trim());
    client.total_tokens += client.calculate_token_length(inputMsg.trim());
    setChatStore({ ...chatStore });
    setInputMsg("");
    await complete();
  };

  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="grow flex flex-col p-2 dark:text-black">
      <Settings
        chatStore={chatStore}
        setChatStore={setChatStore}
        show={showSettings}
        setShow={setShowSettings}
        selectedChatStoreIndex={props.selectedChatIndex}
      />
      <p
        className="cursor-pointer rounded bg-cyan-300 dark:text-white p-1 dark:bg-cyan-800"
        onClick={() => setShowSettings(true)}
      >
        <div>
          <button className="underline">
            {chatStore.systemMessageContent.length > 16
              ? chatStore.systemMessageContent.slice(0, 16) + ".."
              : chatStore.systemMessageContent}
          </button>{" "}
          <button className="underline">
            {chatStore.streamMode ? "STREAM" : "FETCH"}
          </button>
        </div>
        <div className="text-xs">
          <span className="underline">{chatStore.model}</span>{" "}
          <span>
            Tokens:{" "}
            <span className="underline">
              {chatStore.totalTokens}/{chatStore.maxTokens}
            </span>
          </span>{" "}
          <span>
            Cut:{" "}
            <span className="underline">
              {chatStore.postBeginIndex}/
              {chatStore.history.filter(({ hide }) => !hide).length}
            </span>{" "}
          </span>{" "}
          <span>
            Cost:{" "}
            <span className="underline">${chatStore.cost.toFixed(4)}</span>
          </span>
        </div>
      </p>
      <div className="grow overflow-scroll">
        {!chatStore.apiKey && (
          <p className="opacity-60 p-6 rounded bg-white my-3 text-left dark:text-black">
            请先在上方设置 (OPENAI) API KEY
          </p>
        )}
        {!chatStore.apiEndpoint && (
          <p className="opacity-60 p-6 rounded bg-white my-3 text-left dark:text-black">
            请先在上方设置 API Endpoint
          </p>
        )}
        {chatStore.history.length === 0 && (
          <p className="break-all opacity-60 p-6 rounded bg-white my-3 text-left dark:text-black">
            暂无历史对话记录
            <br />
            ⚙Model: {chatStore.model}
            <br />
            ⚙Key: {chatStore.apiKey}
            <br />
            ⚙Endpoint: {chatStore.apiEndpoint}
            <br />
            ⬆点击上方更改此对话的参数（请勿泄漏）
            <br />
            ↖点击左上角 NEW 新建对话
            <br />
            ⚠回答内容和速度会受到对话历史的影响，因此建议为不相关的问题创建一个单独的对话。
            <br />
            ⚠所有历史对话与参数储存在浏览器本地
            <br />
            ⚠详细文档与源代码:{" "}
            <a
              className="underline"
              href="https://github.com/heimoshuiyu/chatgpt-api-web"
              target="_blank"
            >
              github.com/heimoshuiyu/chatgpt-api-web
            </a>
          </p>
        )}
        {chatStore.history.map((_, messageIndex) => (
          <Message
            chatStore={chatStore}
            setChatStore={setChatStore}
            messageIndex={messageIndex}
          />
        ))}
        {showGenerating && (
          <p className="p-2 my-2 animate-pulse dark:text-white">
            {generatingMessage
              ? generatingMessage.split("\n").map((line) => <p>{line}</p>)
              : "生成中，最长可能需要一分钟，请保持网络稳定"}
            ...
          </p>
        )}
        {chatStore.responseModelName && (
          <p className="p-2 my-2 text-center opacity-50 dark:text-white">
            Generated by {chatStore.responseModelName}
            {chatStore.postBeginIndex !== 0 && (
              <>
                <br />
                提示：会话过长，已裁切前 {chatStore.postBeginIndex} 条消息
              </>
            )}
          </p>
        )}
        {chatStore.chatgpt_api_web_version < "v1.3.0" && (
          <p className="p-2 my-2 text-center dark:text-white">
            <br />
            提示：当前会话版本 {chatStore.chatgpt_api_web_version}。
            <br />
            v1.3.0
            引入与旧版不兼容的消息裁切算法。继续使用旧版可能会导致消息裁切过多或过少（表现为失去上下文或输出不完整）。
            <br />
            请在左上角创建新会话：）
          </p>
        )}
        {showRetry && (
          <p className="text-right p-2 my-2 dark:text-white">
            <button
              className="p-1 rounded bg-rose-500"
              onClick={async () => {
                setShowRetry(false);
                await complete();
              }}
            >
              Retry
            </button>
          </p>
        )}
        <div ref={messagesEndRef}></div>
      </div>
      <div className="flex justify-between">
        <textarea
          rows={Math.min(10, (inputMsg.match(/\n/g) || []).length + 2)}
          value={inputMsg}
          onChange={(event: any) => setInputMsg(event.target.value)}
          onKeyPress={(event: any) => {
            console.log(event);
            if (event.ctrlKey && event.code === "Enter") {
              send(event.target.value);
              setInputMsg("");
              return;
            }
            setInputMsg(event.target.value);
          }}
          className="rounded grow m-1 p-1 border-2 border-gray-400 w-0"
          placeholder="Type here..."
        ></textarea>
        <button
          className="disabled:line-through disabled:bg-slate-500 rounded m-1 p-1 border-2 bg-cyan-400 hover:bg-cyan-600"
          disabled={showGenerating || !chatStore.apiKey}
          onClick={() => {
            send(inputMsg);
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

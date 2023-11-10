import { ChatStore, ChatStoreMessage } from "./app";
import { isVailedJSON } from "./message";
import { calculate_token_length } from "./chatgpt";

interface Props {
  chat: ChatStoreMessage;
  chatStore: ChatStore;
  setChatStore: (cs: ChatStore) => void;
  setShowEdit: (se: boolean) => void;
}
export function EditMessageString({
  chat,
  chatStore,
  setChatStore,
  setShowEdit,
}: Props) {
  if (typeof chat.content !== "string") return <div>error</div>;
  return (
    <div className="flex flex-col">
      {chat.tool_call_id && (
        <span className="my-2">
          <label>tool_call_id: </label>
          <input
            className="rounded border border-gray-400"
            value={chat.tool_call_id}
            onChange={(event: any) => {
              chat.tool_call_id = event.target.value;
              setChatStore({ ...chatStore });
            }}
          />
        </span>
      )}
      {chat.tool_calls &&
        chat.tool_calls.map((tool_call) => (
          <div className="flex flex-col w-full">
            <span className="my-2 w-full">
              <label>Tool Call ID: </label>
              <input
                value={tool_call.id}
                className="rounded border border-gray-400"
              />
            </span>
            <span className="my-2 w-full">
              <label>Function: </label>
              <input
                value={tool_call.function.name}
                className="rounded border border-gray-400"
              />
            </span>
            <span className="my-2">
              <label>Arguments: </label>
              <span className="underline">
                Vailed JSON:{" "}
                {isVailedJSON(tool_call.function.arguments) ? "🆗" : "❌"}
              </span>
              <textarea
                className="rounded border border-gray-400 w-full h-32 my-2"
                value={tool_call.function.arguments}
                onChange={(event: any) => {
                  tool_call.function.arguments = event.target.value.trim();
                  setChatStore({ ...chatStore });
                }}
              ></textarea>
            </span>
            <hr className="my-2" />
          </div>
        ))}
      <textarea
        className="rounded border border-gray-400 w-full h-32 my-2"
        value={chat.content}
        onChange={(event: any) => {
          chat.content = event.target.value;
          chat.token = calculate_token_length(chat.content);
          setChatStore({ ...chatStore });
        }}
        onKeyPress={(event: any) => {
          if (event.keyCode == 27) {
            setShowEdit(false);
          }
        }}
      ></textarea>
    </div>
  );
}

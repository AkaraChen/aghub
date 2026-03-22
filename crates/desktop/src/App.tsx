import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@heroui/react";

function App() {
  const [port, setPort] = useState<number | null>(null);

  useEffect(() => {
    invoke<number>("start_server")
      .then(setPort)
      .catch(console.error);
  }, []);

  const apiBase = port ? `http://127.0.0.1:${port}/api/v1` : null;

  return (
    <div className="flex items-center justify-center h-screen">
      <h1 className="text-4xl font-bold">Hello World</h1>
      <Button variant="primary" className="ml-4" isDisabled={!apiBase}>
        {apiBase ? `API: ${apiBase}` : "Starting server…"}
      </Button>
    </div>
  );
}

export default App;

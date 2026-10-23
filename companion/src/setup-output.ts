interface SetupOutputOptions {
  writeLine?: (text: string) => void;
  writeStatus?: (text: string) => void;
  interactive?: boolean;
  color?: boolean;
}

export function createSetupOutput({
  writeLine = (text) => console.log(text),
  writeStatus = (text) => { process.stdout.write(text); },
  interactive = Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb",
  color = interactive && !process.env.NO_COLOR
}: SetupOutputOptions = {}) {
  const accent = (text: string, code: number) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    section(title: string, indent = 0) {
      writeLine("");
      writeLine(accent(" ".repeat(indent) + title, 36));
    },
    detail(label: string, value: string) {
      writeLine(`    ${(label + ":").padEnd(20)} ${value}`);
    },
    line(text = "") {
      writeLine(text);
    },
    async progress<T>(message: string, action: () => Promise<T>): Promise<T> {
      if (!interactive) {
        writeLine(`  ${message}...`);
        return action();
      }
      const frames = "|/-\\";
      let frame = 0;
      const render = () => writeStatus(`\r  ${frames.charAt(frame++ % frames.length)} ${message}...`);
      render();
      const timer = setInterval(render, 100);
      try {
        return await action();
      } finally {
        clearInterval(timer);
        writeStatus("\r\u001b[2K");
      }
    },
    success(text: string) {
      writeLine("");
      writeLine(accent(text, 32));
    }
  };
}

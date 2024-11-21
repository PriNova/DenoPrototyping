import { spawn } from "node:child_process";
import process from "node:process";

export class PersistentShell {
    private shell: ReturnType<typeof spawn> | null = null;
    private stdoutBuffer = "";
    private stderrBuffer = "";

    constructor() {
        this.init();
    }

    private init() {
        const shell = process.platform === "win32" ? "powershell.exe" : "bash";
        const cwd = '' //vscode.workspace.workspaceFolders?.[0]?.uri?.path;
        const shellArgs = process.platform === "win32" ? [] : ["-l"];
        this.shell = spawn(shell, shellArgs, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, LANG: "en_US.UTF-8" },
        });

        this.shell.stdout?.on("data", (data: { toString: () => string; }) => {
            this.stdoutBuffer += data.toString();
        });

        this.shell.stderr?.on("data", (data: { toString: () => string; }) => {
            this.stderrBuffer += data.toString();
        });
    }

    async execute(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // Remove the sanitization that replaces newlines
            // const sanitizedInput = cmd.replace(/\n/g, '\\n')
            const command = sanitizeCommand(cmd);
            if (!this.shell) {
                const error = new Error("Shell not initialized");
                reject(error);
                return;
            }
            this.stdoutBuffer = "";
            this.stderrBuffer = "";

            const checkInterval = setInterval(() => {
                const combinedOutput = this.stdoutBuffer + this.stderrBuffer;

                for (
                    const [errorType, patterns] of Object.entries(
                        SHELL_ERROR_PATTERNS,
                    )
                ) {
                    if (Array.isArray(patterns)) {
                        for (const pattern of patterns) {
                            if (
                                combinedOutput.toLowerCase().includes(
                                    pattern.toLowerCase(),
                                )
                            ) {
                                clearTimeout(timeoutId);
                                clearInterval(checkInterval);
                                const error = new Error(
                                    `${errorType}: ${command}`,
                                );
                                reject(error);
                                return;
                            }
                        }
                    }
                }

                if (this.stdoutBuffer.includes("__END_OF_COMMAND_")) {
                    clearTimeout(timeoutId);
                    clearInterval(checkInterval);
                    if (this.stderrBuffer.trim() === "") {
                        resolve(
                            this.stdoutBuffer.split("__END_OF_COMMAND_")[0]
                                .trim(),
                        );
                    } else {
                        const error = new Error(this.stderrBuffer.trim());
                        reject(error);
                    }
                }
            }, 100);

            const timeoutId = setTimeout(() => {
                clearInterval(checkInterval);
                const error = new Error("Command execution timed out");
                reject(error);
                this.dispose();
                this.init();
            }, 30000);

            // Key fix: Use set -o pipefail to catch pipeline failures
            this.shell.stdin?.write(`
                ${command}
                CMD_EXIT=$?
                if [ $CMD_EXIT -ne 0 ]; then
                    echo "Command failed with exit code $CMD_EXIT" >&2
                fi
                # Still check error patterns for shell builtins and sourcing
                if echo "${command}" | grep -qE "^(source|\.)\s+" && ! [ -f "$(echo "${command}" | cut -d' ' -f2)" ]; then
                    echo "Source file not found" >&2
                fi
                echo "__END_OF_COMMAND_${Date.now()}__"
            \n`);
        });
    }

    public dispose(): void {
        if (this.shell) {
            this.shell.stdin?.end();
            this.shell.stdout?.removeAllListeners();
            this.shell.stderr?.removeAllListeners();
            this.shell.kill();
            this.shell = null;
        }
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
    }
}

export const commandsNotAllowed = [
    "rm",
    "chmod",
    "shutdown",
    "history",
    "user",
    "sudo",
    "su",
    "passwd",
    "chown",
    "chgrp",
    "kill",
    "reboot",
    "poweroff",
    "init",
    "systemctl",
    "journalctl",
    "dmesg",
    "lsblk",
    "lsmod",
    "modprobe",
    "insmod",
    "rmmod",
    "lsusb",
    "lspci",
];

// Create an enum or const object for shell types
export const SHELL_ERROR_PATTERNS = {
    COMMAND_NOT_FOUND: [
        "command not found", // bash, zsh
        "is not recognized", // cmd.exe
        ": No such file or directory", // common unix
        "CommandNotFoundException", // powershell
        "Unknown command", // fish
        "not found in PATH", // some shells
        "not an executable", // some shells
        "cannot find the path", // windows variants
    ],
    PERMISSION_DENIED: ["Permission denied", "Access is denied"],
    // Add more categories as needed
} as const;

export function sanitizeCommand(command: string): string {
    // Basic sanitization, should be more comprehensive in production
    return command.trim().replace(
        /[;&`](?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/g,
        "",
    );
}

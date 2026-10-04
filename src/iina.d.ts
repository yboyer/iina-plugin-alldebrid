// Only the IINA APIs used by this plugin. Runtime is JavaScriptCore, not Node.
interface IinaResponse {
  statusCode: number
  text: string
}
interface IinaRequest {
  data?: Record<string, string | number | undefined>
  headers?: Record<string, string>
}
declare const iina: {
  http: {
    get(url: string, options: IinaRequest): Promise<IinaResponse>
    post(url: string, options: IinaRequest): Promise<IinaResponse>
  }
  preferences: { get(name: string): unknown; set(name: string, value: string): void; sync(): void }
  menu: { item(name: string, action: () => void): unknown; addItem(item: unknown): void }
  standaloneWindow: {
    setProperty(properties: { title: string; resizable: boolean }): void
    setFrame(width: number, height: number): void
    loadFile(path: string): void
    open(): void
    onMessage(name: string, action: (value: string) => void): void
    postMessage(name: string, value: unknown): void
  }
  utils: { open(url: string): void }
  global: {
    createPlayerInstance(options: { url: string; enablePlugins: boolean }): boolean | number
  }
  onMessage(name: string, action: (value: import('./types').LibraryState) => void): void
  postMessage(name: string, value: unknown): void
}

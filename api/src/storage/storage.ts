export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  signedUrl(key: string, seconds: number): Promise<string>;
}

export class MemoryStorage implements Storage {
  objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedUrl(key: string, seconds: number): Promise<string> {
    return `memory://${key}?expires=${seconds}`;
  }
}

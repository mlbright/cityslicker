import type { Stage } from './stage';

/** File name for a Snapshot, e.g. "little-brambleton-year37.png". */
export function snapshotName(cityName: string, applied: number): string {
  const slug = cityName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'city'}-year${Math.floor(applied / 12)}.png`;
}

/**
 * Renders the 3D view (no controls) at twice the screen resolution, as the Viewer sees it now,
 * and returns it as a PNG.
 */
export async function captureSnapshot(stage: Stage): Promise<Blob> {
  const renderer = stage.renderer;
  const canvas = renderer.domElement;
  const ratio = renderer.getPixelRatio();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const maxSide = renderer.capabilities.maxTextureSize;
  const scale = Math.max(1, Math.min(2, 8192 / (width * ratio), maxSide / (width * ratio), maxSide / (height * ratio)));
  renderer.setPixelRatio(ratio * scale);
  stage.resize(width, height);
  stage.render();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  renderer.setPixelRatio(ratio);
  stage.resize(width, height);
  if (!blob) throw new Error('Snapshot failed');
  return blob;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

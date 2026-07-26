import type { ChangeEvent, DragEvent } from "react";

export interface ScreenshotPreview {
  id: string;
  name: string;
  dataUrl: string;
}

interface ContextTrayProps {
  screenshots: ScreenshotPreview[];
  onFiles(files: File[]): void;
  onRemove(id: string): void;
  onSample(): void;
  disabled?: boolean;
}

export function ContextTray({
  screenshots,
  onFiles,
  onRemove,
  onSample,
  disabled = false,
}: ContextTrayProps) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) {
      onFiles(Array.from(event.dataTransfer.files));
    }
  };

  return (
    <div className="context-tray">
      <label
        className="context-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <input
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={disabled}
          aria-label="Add screenshots"
          onChange={onChange}
        />
        <span className="context-dropzone__icon" aria-hidden="true">
          ↗
        </span>
        <span>
          <strong>Drop screenshots here</strong>
          <small>or click to browse · PNG, JPEG, WebP</small>
        </span>
        <span className="context-count">{screenshots.length}/3</span>
      </label>

      {screenshots.length > 0 ? (
        <div className="context-previews" aria-label="Screenshot context">
          {screenshots.map((screenshot) => (
            <div className="context-preview" key={screenshot.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshot.dataUrl} alt="" />
              <span title={screenshot.name}>{screenshot.name}</span>
              <button
                type="button"
                aria-label={`Remove ${screenshot.name}`}
                onClick={() => onRemove(screenshot.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="sample-context-button"
          onClick={onSample}
        >
          <span aria-hidden="true">✦</span>
          Use sample context
          <small>instant demo</small>
        </button>
      )}
    </div>
  );
}


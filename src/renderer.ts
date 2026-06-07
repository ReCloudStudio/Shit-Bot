import { createCanvas, CanvasRenderingContext2D } from '@napi-rs/canvas';
import { ProcessedTweet } from './types';

const CANVAS_WIDTH = 500;
const PADDING = 24;
const AVATAR_SIZE = 48;
const LINE_HEIGHT = 24;

const COLORS = {
  background: '#15202b',
  card: '#192734',
  border: '#38444d',
  text: '#ffffff',
  secondary: '#8899a6',
  accent: '#1da1f2',
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let currentLine = '';
    const words = paragraph.split(' ');

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

function formatTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export async function initRenderer(): Promise<boolean> {
  console.log('Canvas renderer ready');
  return true;
}

export async function renderTweetImage(tweet: ProcessedTweet): Promise<Buffer | null> {
  try {
    let contentLines = 0;
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const wrappedContent = wrapText(tempCtx, tweet.content, CANVAS_WIDTH - PADDING * 2);
    contentLines = wrappedContent.length;

    const headerHeight = AVATAR_SIZE + 16;
    const contentHeight = contentLines * LINE_HEIGHT + 16;
    const footerHeight = 40;
    const totalHeight = PADDING + headerHeight + contentHeight + footerHeight + PADDING;

    const canvas = createCanvas(CANVAS_WIDTH, totalHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, CANVAS_WIDTH, totalHeight);

    const cardX = 10;
    const cardY = 10;
    const cardWidth = CANVAS_WIDTH - 20;
    const cardHeight = totalHeight - 20;

    ctx.fillStyle = COLORS.card;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 16);
    ctx.fill();

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    const avatarX = cardX + PADDING;
    const avatarY = cardY + PADDING;

    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tweet.author.charAt(0).toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2);

    const textX = avatarX + AVATAR_SIZE + 12;
    const textY = avatarY + 8;

    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(tweet.authorName, textX, textY);

    ctx.fillStyle = COLORS.secondary;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`@${tweet.author}`, textX, textY + 20);

    const contentY = avatarY + AVATAR_SIZE + 16;
    ctx.fillStyle = COLORS.text;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    let lineY = contentY;
    for (const line of wrappedContent) {
      ctx.fillText(line, cardX + PADDING, lineY);
      lineY += LINE_HEIGHT;
    }

    const footerY = cardY + cardHeight - PADDING - 16;

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + PADDING, footerY - 8);
    ctx.lineTo(cardX + cardWidth - PADDING, footerY - 8);
    ctx.stroke();

    ctx.fillStyle = COLORS.secondary;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(tweet.publishedAt), cardX + PADDING, footerY);

    ctx.fillStyle = COLORS.accent;
    ctx.textAlign = 'right';
    ctx.fillText('View on X', cardX + cardWidth - PADDING, footerY);

    const buffer = canvas.toBuffer('image/png');
    return buffer;
  } catch (error) {
    console.error(`Failed to render tweet ${tweet.id}:`, error);
    return null;
  }
}

export async function shutdownRenderer(): Promise<void> {
  console.log('Renderer shutdown');
}

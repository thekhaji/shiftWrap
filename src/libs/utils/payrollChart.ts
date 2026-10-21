import { createCanvas } from '@napi-rs/canvas';

export interface PayrollChartInput {
    scopeName: string;
    monthLabels: string[];      // 12 short names
    amounts: number[];          // 12 values, index 0 = January
    currentMonth: number;       // 1-12
    labels: { thisMonth: string; title: string };
}

const W = 1200;
const H = 600;
const FONT = 'sans-serif';

export function formatMoney(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

function shortMoney(value: number): string {
    if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
    return String(value);
}

// round the axis maximum up to 1, 2, 2.5, 5 or 10 times a power of ten
function niceMax(value: number): number {
    if (value <= 0) return 1;
    const pow = 10 ** Math.floor(Math.log10(value));
    const n = value / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

// Left: this month's total. Right: bars for the whole year.
export function renderPayrollChart(input: PayrollChartInput): Buffer {
    const { amounts, currentMonth } = input;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // ---- total card ----
    const cardX = 30, cardY = 30, cardW = 330, cardH = H - 60;
    ctx.fillStyle = '#eef3ff';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 20);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#4b5b82';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(input.scopeName, cardX + cardW / 2, cardY + 90, cardW - 40);
    ctx.font = `22px ${FONT}`;
    ctx.fillText(input.labels.thisMonth, cardX + cardW / 2, cardY + 250);

    const total = formatMoney(amounts[currentMonth - 1]);
    ctx.fillStyle = '#1d3fbf';
    ctx.font = `bold 56px ${FONT}`;
    ctx.fillText(total, cardX + cardW / 2, cardY + 325, cardW - 40);

    // ---- bar chart ----
    const left = 440, right = W - 40, top = 100, bottom = H - 90;
    const plotW = right - left, plotH = bottom - top;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f2937';
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(input.labels.title, left, 55);

    const max = niceMax(Math.max(...amounts));
    ctx.font = `18px ${FONT}`;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = bottom - (plotH * i) / 4;
        ctx.strokeStyle = i === 0 ? '#9ca3af' : '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'right';
        ctx.fillText(shortMoney((max * i) / 4), left - 10, y + 6);
    }

    const slot = plotW / 12;
    const barW = slot * 0.6;
    ctx.textAlign = 'center';
    amounts.forEach((value, i) => {
        const x = left + slot * i + (slot - barW) / 2;
        const h = (value / max) * plotH;
        ctx.fillStyle = i === currentMonth - 1 ? '#1d3fbf' : '#a9bbf0';
        if (h > 0) {
            ctx.beginPath();
            ctx.roundRect(x, bottom - h, barW, h, [6, 6, 0, 0]);
            ctx.fill();
            ctx.fillStyle = '#374151';
            ctx.font = `15px ${FONT}`;
            ctx.fillText(shortMoney(value), x + barW / 2, bottom - h - 8);
        }
        ctx.fillStyle = i === currentMonth - 1 ? '#1d3fbf' : '#6b7280';
        ctx.font = `${i === currentMonth - 1 ? 'bold ' : ''}17px ${FONT}`;
        ctx.fillText(input.monthLabels[i], x + barW / 2, bottom + 28);
    });

    return canvas.toBuffer('image/png');
}

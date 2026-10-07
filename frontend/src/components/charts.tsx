import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cx } from '../lib/utils';

const tooltipStyle = {
  background: 'rgb(var(--card))',
  border: '1px solid rgba(var(--border),0.6)',
  borderRadius: '0.75rem',
  boxShadow: 'var(--shadow)',
  color: 'rgb(var(--text))',
  fontSize: '12px',
};

const axisStyle = { fontSize: 11, fill: 'rgb(var(--text-3))' };

function LegendContent({ payload }: any) {
  return (
    <ul className="flex flex-wrap justify-center gap-3 mt-1">
      {payload.map((entry: any, i: number) => (
        <li key={i} className="flex items-center gap-1.5 text-xs text-ink2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: entry.color }} />
          {entry.value}
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({ title, subtitle, action, children, className }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cx('card p-4 anim-in', className)}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-sm">{title}</h4>
          {subtitle && <p className="text-xs text-ink3 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function AreaChartCard({ title, subtitle, data, xKey, series, className }: {
  title: string; subtitle?: string; data: any[]; xKey: string;
  series: { key: string; name: string; color: string }[]; className?: string;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="chart-box">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--border),0.5)" vertical={false} />
            <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend content={<LegendContent />} />
            {series.map((s) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color}
                strokeWidth={2.5} fill={`url(#grad-${s.key})`} dot={false} activeDot={{ r: 4 }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function LineChartCard({ title, subtitle, data, xKey, series, className }: {
  title: string; subtitle?: string; data: any[]; xKey: string;
  series: { key: string; name: string; color: string }[]; className?: string;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="chart-box">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--border),0.5)" vertical={false} />
            <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend content={<LegendContent />} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color}
                strokeWidth={2.5} dot={{ r: 3, fill: s.color }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function BarChartCard({ title, subtitle, data, xKey, series, className, layout = 'vertical' }: {
  title: string; subtitle?: string; data: any[]; xKey: string;
  series: { key: string; name: string; color: string }[]; className?: string; layout?: 'vertical' | 'horizontal';
}) {
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="chart-box">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 5, left: layout === 'vertical' ? -10 : -15, bottom: 0 }}
            layout={layout}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--border),0.5)" horizontal={layout === 'vertical'} vertical={layout !== 'vertical'} />
            {layout === 'vertical' && <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />}
            {layout === 'vertical' && <YAxis type="category" dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} width={110} />}
            {layout === 'horizontal' && <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />}
            {layout === 'horizontal' && <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />}
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(var(--accent),0.08)' }} />
            <Legend content={<LegendContent />} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[6, 6, 0, 0]} barSize={22} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function DonutChartCard({ title, subtitle, data, className, centerLabel }: {
  title: string; subtitle?: string; data: { name: string; value: number; color: string }[]; className?: string; centerLabel?: string;
}) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="flex flex-col items-center">
        <div className="relative chart-box-sm">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          {centerLabel !== undefined && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold">{centerLabel}</span>
              <span className="text-[11px] text-ink3">total</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 w-full mt-1">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="text-ink2 truncate">{d.name}</span>
              <span className="font-semibold ml-auto">{d.value}{total > 0 ? ` (${Math.round((d.value / total) * 100)}%)` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

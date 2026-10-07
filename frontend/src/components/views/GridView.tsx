import type { Task } from '../../lib/types';
import { TaskCard } from '../TaskCard';

export function GridView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
      {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
    </div>
  );
}

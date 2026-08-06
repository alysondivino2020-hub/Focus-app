import { db } from './database.js';
import { uid, sanitizeObject } from './utils.js';

export async function saveGoal(input) {
  const goal = sanitizeObject({
    id: input.id || uid('goal'),
    userId: input.userId || 'local',
    title: input.title || '',
    description: input.description || '',
    deadline: input.deadline || '',
    category: input.category || 'personal',
    priority: input.priority || 'normal',
    progress: Number(input.progress || 0),
    steps: Array.isArray(input.steps) ? input.steps : [],
    status: input.status || 'active',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  });
  if (!goal.title) throw new Error('Informe o título da meta.');
  goal.progress = calculateGoalProgress(goal);
  return db.put('goals', goal);
}

export async function toggleGoalStep(goalId, stepId) {
  const goal = await db.get('goals', goalId);
  if (!goal) return null;
  const steps = (goal.steps || []).map(step => step.id === stepId ? { ...step, done: !step.done } : step);
  return db.put('goals', { ...goal, steps, progress: calculateGoalProgress({ ...goal, steps }) });
}

export function calculateGoalProgress(goal) {
  if (goal.steps?.length) {
    const done = goal.steps.filter(step => step.done).length;
    return Math.round((done / goal.steps.length) * 100);
  }
  return Math.max(0, Math.min(100, Number(goal.progress || 0)));
}

export function splitGoalIntoSteps(title, description = '') {
  const subject = title || 'meta';
  const context = description ? ` considerando: ${description}` : '';
  return [
    { id: uid('step'), title: `Definir o resultado concreto de “${subject}”${context}`, done: false },
    { id: uid('step'), title: 'Levantar recursos, restrições e prazo disponível', done: false },
    { id: uid('step'), title: 'Executar a primeira ação com duração máxima de 30 minutos', done: false },
    { id: uid('step'), title: 'Revisar o progresso e ajustar o plano', done: false },
    { id: uid('step'), title: 'Concluir e registrar o resultado final', done: false }
  ];
}

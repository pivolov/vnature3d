import { expect, it } from 'vitest';
import { createEditor } from './editor';

it('undoes and redoes a project edit and clears redo after branching', () => {
  const editor = createEditor();
  const rename = (name: string) => editor.getState().change((project) => ({ ...project, name }));
  const original = editor.getState().project;
  rename('Orbit');
  editor.getState().undo();
  expect(editor.getState().project).toBe(original);
  editor.getState().redo();
  expect(editor.getState().project.name).toBe('Orbit');
  editor.getState().undo();
  rename('Loop');
  editor.getState().redo();
  expect(editor.getState().project.name).toBe('Loop');
  expect(editor.getState().future).toHaveLength(0);
});

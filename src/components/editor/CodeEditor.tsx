'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';
import type { Language } from '@/types/vfs';

const setHighlightedLines = StateEffect.define<number[]>();

const lineMark = Decoration.line({ class: 'cm-arc-line' });

const highlightedLinesField: StateField<number[]> = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHighlightedLines)) return e.value;
    return tr.docChanged ? value.filter((n: number) => n <= tr.newDoc.lines) : value;
  },
  provide: () =>
    EditorView.decorations.compute([], (state): DecorationSet => {
      const lines: number[] = state.field(highlightedLinesField);
      return Decoration.set(
        lines.filter((n: number) => n >= 1 && n <= state.doc.lines).map((n: number) => lineMark.range(state.doc.line(n).from)),
        true,
      );
    }),
});

const arcTheme = EditorView.theme({
  '&': { color: 'hsl(var(--foreground))', backgroundColor: 'hsl(var(--background))', height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'hsl(var(--primary))', padding: '6px 0' },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
  },
  '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.4)' },
  '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--muted) / 0.5)', color: 'hsl(var(--foreground))' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.28)',
  },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--primary))', borderLeftWidth: '2px' },
  '.cm-arc-line': { backgroundColor: 'hsl(var(--arc) / 0.16)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRadius: '3px',
    padding: '0 4px',
  },
  '.cm-tooltip': {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--popover-foreground))',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'hsl(var(--primary) / 0.3)' },
  '.cm-panels': { backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' },
  '.cm-searchMatch': { backgroundColor: 'hsl(var(--primary) / 0.35)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'hsl(var(--primary) / 0.6)' },
});

const arcHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier], color: 'hsl(280 80% 76%)' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: 'hsl(200 90% 78%)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'hsl(40 90% 72%)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'hsl(170 70% 64%)' },
  { tag: [t.definition(t.name), t.separator], color: 'hsl(210 20% 90%)' },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace],
    color: 'hsl(15 85% 72%)',
  },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: 'hsl(20 90% 68%)' },
  { tag: [t.meta, t.comment], color: 'hsl(215 15% 50%)', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.atom, t.bool], color: 'hsl(320 70% 76%)' },
  { tag: t.invalid, color: 'hsl(0 80% 68%)' },
  { tag: t.heading, color: 'hsl(200 90% 78%)', fontWeight: 'bold' },
  { tag: t.list, color: 'hsl(265 80% 72%)' },
]);

function languageExtension(lang: Language): Extension[] {
  switch (lang) {
    case 'typescript':
      return [javascript({ typescript: true })];
    case 'javascript':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })];
    case 'json':
      return [json()];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'markdown':
      return [markdown()];
    case 'python':
      return [python()];
    default:
      return [];
  }
}

export interface CodeEditorProps {
  path: string;
  value: string;
  language: Language;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  readOnly?: boolean;
  highlightLines?: number[];
  onChange?(value: string): void;
  onSave?(): void;
  onCursorLine?(line: number): void;
}

export function CodeEditor({
  path,
  value,
  language,
  fontSize,
  tabSize,
  wordWrap,
  readOnly,
  highlightLines,
  onChange,
  onSave,
  onCursorLine,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onSave, onCursorLine });
  const fontSizeCompartment = useMemo<Compartment>(() => new Compartment(), []);
  const wrapCompartment = useMemo<Compartment>(() => new Compartment(), []);

  useEffect(() => {
    cbs.current = { onChange, onSave, onCursorLine };
  }, [onChange, onSave, onCursorLine]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(arcHighlight, { fallback: true }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              cbs.current.onSave?.();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        fontSizeCompartment.of(EditorView.theme({ '.cm-content': { fontSize: `${fontSize}px` } })),
        wrapCompartment.of(EditorView.lineWrapping),
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorState.tabSize.of(tabSize),
        indentUnit.of(' '.repeat(tabSize)),
        EditorView.contentAttributes.of({ 'data-path': path, 'aria-label': `Editor: ${path}` }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange?.(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            cbs.current.onCursorLine?.(u.state.doc.lineAt(head).number);
          }
        }),
        highlightedLinesField,
        arcTheme,
        ...languageExtension(language),
      ],
    });

    const instance = new EditorView({ state, parent });
    view.current = instance;
    // exposto para os testes E2E dirigirem o editor sem simular digitacao
    (parent as unknown as { __cmView?: EditorView }).__cmView = instance;
    parent.dataset.cmReady = '1';

    return () => {
      instance.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: fontSizeCompartment.reconfigure(EditorView.theme({ '.cm-content': { fontSize: `${fontSize}px` } })) });
  }, [fontSize, fontSizeCompartment]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: wrapCompartment.reconfigure(EditorView.lineWrapping) });
  }, [wordWrap, wrapCompartment]);

  useEffect(() => {
    view.current?.dispatch({ effects: setHighlightedLines.of(highlightLines ?? []) });
  }, [highlightLines]);

  return <div ref={host} className="h-full w-full overflow-hidden" data-testid="code-editor" />;
}
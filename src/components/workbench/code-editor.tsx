"use client";

import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function CodeEditor({ value, onChange }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          markdown(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": {
              backgroundColor: "#f8f6ee",
              color: "#191a17",
              fontSize: "13px",
              height: "100%",
            },
            ".cm-content": {
              caretColor: "#d1ff3c",
              fontFamily: "var(--font-geist-mono)",
              padding: "18px",
            },
            ".cm-gutters": {
              backgroundColor: "#efede4",
              borderRight: "1px solid #d9d5c8",
              color: "#7d7a70",
            },
            ".cm-activeLine": {
              backgroundColor: "#ece8da",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "#e4dfcf",
            },
            "&.cm-focused": {
              outline: "2px solid rgba(209, 255, 60, 0.28)",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [onChange, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className="h-full overflow-hidden" />;
}

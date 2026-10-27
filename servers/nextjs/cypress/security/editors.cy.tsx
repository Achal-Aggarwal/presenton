import { useState } from "react";
import { mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import MarkdownEditor from "@/app/(presentation-generator)/components/MarkdownEditor";
import TiptapText from "@/app/(presentation-generator)/components/TiptapText";
import { TiptapInlineTextEditor } from "@/components/slide-editor/text/TiptapInlineTextEditor";
import type { TextRun } from "@/components/slide-editor/types";

function MarkdownHarness() {
  const [content, setContent] = useState("# Heading\n\n**bold** and *italic*\n\n- first\n- second");
  const [changes, setChanges] = useState(0);
  return <>
    <button data-cy="replace" onClick={() => setContent("## Updated\n\n`code`")}>Replace</button>
    <output data-cy="changes">{changes}</output>
    <MarkdownEditor content={content} onChange={(value) => { setContent(value); setChanges((n) => n + 1); }} />
  </>;
}

function InlineHarness() {
  const [runs, setRuns] = useState<TextRun[]>([
    { text: "Energy: ", font: { family: "Arial", size: 24 } },
    { type: "latex", latex: "E=mc^2", font: { family: "Arial", size: 24 } },
  ]);
  return <>
    <TiptapInlineTextEditor autoFocus={false} baseFont={{ family: "Arial", size: 24 }} editorStyle={{ fontSize: 24 }} runs={runs}
      onRunsChange={setRuns} onBlurOutside={() => {}} onCommitShortcut={() => {}} onEscape={() => {}} onSelectionChange={() => {}} />
    <output data-cy="runs">{JSON.stringify(runs)}</output>
  </>;
}

describe("Secure editor compatibility", () => {
  it("does not copy inherited event handlers into serialized DOM", () => {
    cy.document().then((document) => {
      const attributes = mergeAttributes(JSON.parse('{"alt":"safe","__proto__":{"src":"x-invalid://canary","onerror":"alert(1)"}}'));
      const image = DOMSerializer.renderSpec(document, ["img", attributes]).dom as HTMLImageElement;
      expect(image.alt).to.equal("safe");
      expect(image.hasAttribute("src")).to.equal(false);
      expect(image.hasAttribute("onerror")).to.equal(false);
    });
  });

  it("preserves Markdown structure, external synchronization and undo", () => {
    cy.mount(<MarkdownHarness />);
    cy.get("[contenteditable=true]").as("editor");
    cy.get("@editor").find("h1").should("have.text", "Heading");
    cy.get("@editor").find("strong").should("have.text", "bold");
    cy.get("@editor").find("em").should("have.text", "italic");
    cy.get("@editor").find("li").should("have.length", 2);
    cy.get('[data-cy="replace"]').click();
    cy.get("@editor").find("h2").should("have.text", "Updated");
    cy.get('[data-cy="changes"]').should("have.text", "0");
    cy.get("@editor").click().type("{moveToEnd}!");
    cy.get('[data-cy="changes"]').should("not.have.text", "0");
    cy.get("@editor").should("contain.text", "code!");
    cy.get("@editor").type(Cypress.platform === "darwin" ? "{meta}z" : "{ctrl}z");
    cy.get("@editor").should("not.contain.text", "code!");
  });

  it("keeps the selection toolbar and formatting commands working", () => {
    const save = cy.stub().as("save");
    cy.mount(<TiptapText content="Hello world" onContentChange={save} />);
    cy.get("[contenteditable=true]").click().type("{selectAll}");
    cy.get('button[title="Bold"]').should("be.visible").click();
    cy.get("[contenteditable=true] strong").should("have.text", "Hello world");
    cy.get("[contenteditable=true]").focus().blur();
    cy.get("@save").should("have.been.called");
  });

  it("preserves editable LaTeX atoms and text-run updates", () => {
    cy.mount(<InlineHarness />);
    cy.get('textarea[aria-label="Edit LaTeX expression"]').should("have.value", "E=mc^2")
      .clear().type("a^2+b^2=c^2", { parseSpecialCharSequences: false });
    cy.get('[data-cy="runs"]').should("contain.text", "a^2+b^2=c^2").and("contain.text", "Energy: ");
  });
});

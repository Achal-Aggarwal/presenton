import mermaid from "mermaid";

describe("Diagram rendering", () => {
  it("preserves flowcharts while rejecting executable link targets", () => {
    cy.document().then(async (document) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      const { svg } = await mermaid.render(
        "security-flowchart",
        'flowchart LR\n A[Start] --> B[End]\n click A "javascript:alert(1)"',
      );
      const template = document.createElement("template");
      template.innerHTML = svg;
      expect(template.content.querySelector("svg")).not.to.equal(null);
      expect(template.content.textContent).to.contain("Start").and.to.contain("End");
      expect(template.content.querySelectorAll(".node")).to.have.length(2);
      expect(template.content.querySelector("script, [onerror], [onload], a[href^='javascript:']")).to.equal(null);
    });
  });
});

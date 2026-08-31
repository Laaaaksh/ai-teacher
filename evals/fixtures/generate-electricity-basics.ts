/**
 * Regenerates evals/fixtures/electricity-basics.pdf — a real, original,
 * three-chapter PDF used by evals/retrieval-eval.ts. Committed as a binary
 * fixture (`electricity-basics.pdf`); this script exists so the fixture is
 * reproducible rather than an opaque blob. Run with:
 *
 *   npx tsx evals/fixtures/generate-electricity-basics.ts
 */
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import path from "node:path";

const OUT_PATH = path.join(__dirname, "electricity-basics.pdf");

function chapter(doc: PDFKit.PDFDocument, heading: string, paragraphs: string[]): void {
  doc.addPage().fontSize(20).text(heading);
  doc.moveDown();
  doc.fontSize(12);
  for (const p of paragraphs) {
    doc.text(p);
    doc.moveDown();
  }
}

async function main() {
  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = createWriteStream(OUT_PATH);
  doc.pipe(stream);

  chapter(doc, "Chapter 1: Current and Voltage", [
    "Electric current is the rate of flow of electric charge through a conductor, measured in amperes. " +
      "A current flows when there is a closed path, or circuit, connecting the terminals of a source such as a battery.",
    "Voltage, also called potential difference, is the energy provided per unit charge that pushes current through a circuit, measured in volts. " +
      "A battery's voltage rating tells you how much energy it gives to each unit of charge that passes through it.",
    "Think of voltage as water pressure in a pipe and current as the rate of water flow: higher pressure pushes water through faster, " +
      "just as higher voltage pushes more current through a conductor of a given resistance.",
  ]);

  chapter(doc, "Chapter 2: Resistance and Ohm's Law", [
    "Resistance is a material's opposition to the flow of electric current, measured in ohms. " +
      "Conductors like copper have low resistance; insulators like rubber have very high resistance.",
    "Ohm's Law states that the current through a conductor between two points is directly proportional to the voltage across the two points, " +
      "and inversely proportional to the resistance between them. It is written as V = I times R, where V is voltage, I is current, and R is resistance.",
    "If resistance increases while voltage stays constant, current decreases — not increases. This is a common misconception: " +
      "students sometimes assume current rises with resistance because both terms sound related to 'more', but Ohm's Law says the opposite.",
    "For example, if a 12 volt battery is connected across a 4 ohm resistor, the current is 12 divided by 4, which equals 3 amperes.",
  ]);

  chapter(doc, "Chapter 3: Circuits and Kirchhoff's Laws", [
    "A series circuit connects components end to end so the same current flows through every component, while the voltage divides across them. " +
      "A parallel circuit connects components across the same two nodes so the voltage across each is the same, while the current divides between them.",
    "Kirchhoff's Current Law states that the total current flowing into a junction equals the total current flowing out of it — charge cannot accumulate at a junction.",
    "Kirchhoff's Voltage Law states that the sum of all voltage drops around any closed loop in a circuit equals zero. " +
      "In a series circuit, this means the battery's voltage equals the sum of the voltage drops across every resistor in the loop.",
    "Applying Kirchhoff's Voltage Law to a series circuit with two resistors: if the battery supplies 10 volts and the first resistor drops 6 volts, " +
      "the second resistor must drop the remaining 4 volts, so the two drops sum back to the battery's 10 volts.",
  ]);

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  console.log(`Wrote ${OUT_PATH}`);
}

main();

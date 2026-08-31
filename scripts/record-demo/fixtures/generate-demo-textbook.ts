/**
 * Regenerates scripts/record-demo/fixtures/demo-textbook.pdf — a real,
 * original five-chapter PDF used only by the demo recorder
 * (scripts/record-demo/record.ts). Deliberately separate from
 * evals/fixtures/electricity-basics.pdf (that one is a three-chapter fixture
 * pinned to hardcoded page numbers in evals/retrieval-eval.ts; adding a
 * chapter here would risk drifting it). This fixture exists so the demo can
 * literally ask for "Chapter 4" the way the assessment's own scenario does.
 * Chapter 4 recaps Ohm's Law's resistance/current relationship on purpose —
 * it is the exact misconception ("current increases" when it should
 * decrease) the assessment uses as its own worked example, so the demo's
 * wrong-answer checkpoint is drawn from the material a judge can verify.
 *
 * Run with: npx tsx scripts/record-demo/fixtures/generate-demo-textbook.ts
 */
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import path from "node:path";

const OUT_PATH = path.join(__dirname, "demo-textbook.pdf");

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

  doc.addPage().fontSize(26).text("Foundations of Electricity", { align: "center" });
  doc.moveDown(2).fontSize(14).text("A short course for beginners", { align: "center" });

  chapter(doc, "Chapter 1: What Is Electricity?", [
    "Electricity is the flow of electric charge, usually carried by electrons moving through a conductor such as a copper wire. " +
      "Materials that let charge move freely are called conductors; materials that resist this movement strongly are called insulators.",
    "An atom's electrons can be dislodged from their outer shell and pushed from atom to atom. This directed movement of charge, " +
      "when it happens in a continuous loop called a circuit, is what we call an electric current.",
    "Static electricity, by contrast, is charge that has built up on a surface and is not flowing anywhere — the small shock from " +
      "touching a doorknob after walking on carpet is static charge suddenly discharging, not a circuit's current.",
  ]);

  chapter(doc, "Chapter 2: Voltage and Circuits", [
    "Voltage, also called potential difference, is the energy given to each unit of charge by a source such as a battery, measured in volts. " +
      "It is voltage that pushes current around a circuit, in the same way that pressure pushes water through a pipe.",
    "A circuit needs a closed, unbroken path: a source, a conductor, and a load (something that uses the electrical energy, such as a bulb or a motor). " +
      "Break the path anywhere — for instance by opening a switch — and the current stops everywhere in that loop at once.",
    "In a series circuit, components are connected one after another so the same current passes through each of them, while the source voltage " +
      "is shared out across them. In a parallel circuit, components share the same two connection points, so each sees the full source voltage, " +
      "while the total current from the source splits between the branches.",
  ]);

  chapter(doc, "Chapter 3: Electrical Power, Energy, and Household Safety", [
    "Electric power is the rate at which electrical energy is converted — into heat, light, or motion — measured in watts. " +
      "Power is the product of voltage and current: P = V * I. Combining this with Ohm's Law (V = I * R) also gives P = I^2 * R and P = V^2 / R, " +
      "three equivalent ways to reach the same answer depending on which two quantities you already know.",
    "Worked example: a household kettle is rated at 230 volts and draws 4 amperes while heating. Its power is P = V * I = 230 * 4 = 920 watts, " +
      "meaning it converts about 920 joules of electrical energy into heat every second.",
    "Electrical energy is power sustained over time: energy equals power multiplied by time. Utility bills measure this in kilowatt-hours (kWh), " +
      "not joules — one kWh is the energy used by a 1000-watt appliance running for one hour. That 920-watt kettle run for 15 minutes (0.25 hours) " +
      "uses 0.920 * 0.25 = 0.23 kWh.",
    "Because power rises with the SQUARE of current (P = I^2 * R), a fault that lets current run higher than a circuit's wiring was designed for " +
      "generates heat far faster than the current increase alone suggests — this is precisely why household circuits are protected.",
    "A fuse is a deliberately weak link — a thin wire or metal strip inside it melts and breaks the circuit once current exceeds a rated value, " +
      "before the wiring elsewhere in the house can overheat. A circuit breaker does the same job with a mechanical switch that trips instead of " +
      "melting, so it can be reset and reused rather than replaced.",
    "Earthing (grounding) connects a device's metal casing to the ground via a low-resistance wire. If a fault lets a live wire touch the casing, " +
      "earthing gives the resulting fault current a safe, low-resistance path to flow through instead of through a person who touches the casing, " +
      "and that surge of current is usually large enough to blow the fuse or trip the breaker immediately.",
  ]);

  chapter(doc, "Chapter 4: Resistance and Ohm's Law", [
    "Resistance is a material's opposition to the flow of current, measured in ohms. Thin, long, or poorly conducting wires have more " +
      "resistance than thick, short, highly conductive ones — this is why a hairdryer's heating element is a thin coiled wire, not a thick one.",
    "Ohm's Law relates the three quantities: voltage equals current multiplied by resistance, written V = I * R. Equivalently, current equals " +
      "voltage divided by resistance: I = V / R.",
    "A common misconception is that increasing resistance increases current, because both words sound like they mean 'more'. Ohm's Law says " +
      "the opposite: if voltage is held constant and resistance goes up, current goes DOWN, because I = V / R and a larger denominator gives a smaller result.",
    "Worked example: a 12 volt battery is connected across a 4 ohm resistor. The current is 12 / 4 = 3 amperes. If that resistor is swapped " +
      "for a 6 ohm resistor at the same 12 volts, the current falls to 12 / 6 = 2 amperes — less current, not more, because resistance rose.",
  ]);

  chapter(doc, "Chapter 5: Magnetism and Electromagnetic Induction", [
    "A current-carrying wire produces a magnetic field around itself — this is the basis of electromagnets, which are simply coils of wire " +
      "that become magnetic only while current flows through them, unlike a permanent magnet.",
    "Electromagnetic induction, discovered by Michael Faraday, is the production of a voltage in a conductor when the magnetic field around it " +
      "changes. This is the principle behind electric generators, which convert mechanical motion into electrical energy.",
  ]);

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  console.log(`Wrote ${OUT_PATH}`);
}

main();

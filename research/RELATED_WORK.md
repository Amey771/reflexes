# Related work and contribution boundary

Initial source review: 2026-10-21. This is a scoping review, not an exhaustive novelty assessment. Abstracts and official repositories establish the broad overlap; inspect full methods, assumptions, code and recent citations before finalizing a paper claim.

| Work / primary source | Established overlap | Implication for Reflexes |
|---|---|---|
| [FrugalGPT](https://arxiv.org/abs/2305.05176), Chen, Zaharia & Zou, 2023; [official code](https://github.com/stanford-futuredata/FrugalGPT) | Learns cost-effective combinations/cascades of LLMs | Cheap-then-expensive escalation is established; it is not our novelty |
| [RouteLLM](https://arxiv.org/abs/2406.18665), Ong et al., 2024 / ICLR 2025; [official code](https://github.com/lm-sys/RouteLLM) | Learns strong/weak model routing using preference data | Model selection and cost/quality trade-offs already have strong open-source baselines |
| [AutoMix](https://arxiv.org/abs/2310.12963), Aggarwal et al., NeurIPS 2024 | Self-verification and a POMDP router for escalation under noisy confidence | Confidence-based escalation and uncertainty-aware routing are established |
| [Adaptive LLM Routing under Budget Constraints](https://arxiv.org/abs/2508.21141), Panda et al., Findings EMNLP 2025 | Contextual-bandit routing with online feedback and budget policy | Online adaptation under budgets is not novel by itself |

Further priority checks before claiming novelty: selective prediction/risk control, online drift monitoring, confidence sequences, budgeted active testing, adaptive computation, and step-level agent routing. Recent works surfaced by search must be verified from their primary papers before being incorporated; the contribution cannot be justified by omitting them.

Working distinction to test: the lifecycle of **promotion, continued checking, revocation and revalidation at a stable typed decision node**, measured under delayed feedback and controlled shift with complete cost accounting. This is an engineering focus and a research hypothesis. It is not a verified claim that no previous system does it.

A useful paper would need to show which lifecycle/audit design makes a measurable difference against comparable methods, where it fails, and why. If the answer is that a simple fixed audit performs just as well, the honest output is a reproducible benchmark and technical report.

## Reading checklist

For each relevant paper, record: decision unit; available feedback; how confidence is obtained; online versus offline updates; calibration data and assumptions; handling of shift; cost definition; baselines; released data/code and license; reproducibility gaps. Implement named comparators faithfully or label simplified baselines explicitly.

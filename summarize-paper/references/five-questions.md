# Five Questions

Read this before drafting the claim rows. Answer the five questions below in order,
then retain `不足/局限` and `未来前景/后续工作` as supplementary sections.
Use the dimension names exactly as listed: they are shared by the exporters and webpage.

| Order | Question | `dimension` |
|---|---|---|
| 1 | 论文解决什么问题？ | 研究目的 |
| 2 | 为什么要解决？ | 研究动机 |
| 3 | 用了什么办法？ | 使用技术/方法 |
| 4 | 实验结果怎么样？ | 实验与结果 |
| 5 | 这个方法到底贡献了什么？ | 主要贡献 |

## 1. Problem

State the concrete task or research question, the object being studied, the target
outcome, and relevant conditions or constraints. For a computational task, describe
the input and expected output when the paper provides them. Distinguish the problem
from the solution name: “uses an LLM” is not a statement of the problem.

## 2. Motivation

Explain the paper's reason for addressing the problem: the shortcomings of previous
approaches, an unmet need, a practical cost, or a scientific gap, and why it matters
in the setting discussed by the authors. Anchor this to the introduction, related
work, or problem analysis. Do not duplicate the task statement or supply a general
field narrative from memory. A motivation claim made by the authors is not proof
that their solution achieves the claimed benefit.

## 3. Method

Describe the approach as an understandable sequence: inputs, main stages, essential
components, and outputs, including how the central mechanism addresses the stated
problem. Separate reused techniques from proposed changes. Include training,
inference, mathematical assumptions, or implementation choices when they are
material to understanding the paper; do not invent missing details.

## 4. Experiments and results

Connect findings to their evaluation setting: datasets or cases, experimental
baselines, metrics and units, reported values, and what comparison those values
support. Include ablations, efficiency, failure cases, or user studies when present.
Distinguish measured results from demonstrations and author claims. Do not invent
effect sizes or significance, treat a related-work citation as an experimental
baseline, or generalize a result beyond the tested setting. For a theoretical,
survey, or position paper without experiments, explicitly state that and describe
the actual validation or evidence under this question.

## 5. Contribution

Explain what the work adds relative to the prior approaches discussed in the paper:
a new mechanism, a useful integration or system capability, a dataset, a theoretical
result, an evaluation, or an empirical finding. Identify which parts are new and
which are adopted. Connect each claimed benefit to evidence in the method, analysis,
experiments, or discussion, and state the scope supported by that evidence.
Do not merely repeat the pipeline or a list of performance numbers. Avoid treating
every component as an innovation or describing a claimed contribution as a proven
advance when the evaluation does not establish it. Keep the authors' explicit
claims separate from any cautious interpretation of their significance.

## Missing information and evidence

Keep each claim's `basis_type`, `evidence`, `confidence`, and `review_suggestion`.
If the supplied paper does not support an answer, write an explicit `未提及` row
identifying what is unavailable. Distinguish “the supplied excerpt lacks this
section” from “the complete paper does not report this information”. Do not create
an answer from another section merely to fill the seven-dimension checklist.

Existing six-dimension summaries may already mention motivation inside `研究目的`,
but that requires rereading their claims and source before splitting them. The
website displays missing-answer notices for old records; it does not infer new
claims or alter stored summaries. Upgrade an old summary only from supplied
evidence, and regenerate all three output formats together.

import { createZodDto } from 'nestjs-zod';
import { CreateProposalSchema } from './create-proposal.dto';

/**
 * Editing while nobody has answered yet.
 *
 * The addressee is not editable, and that is the whole shape of this schema.
 * Moving a proposal to another lecturer is not an edit — the first one has been
 * told about it and may be reading it right now — so it is done by withdrawing
 * and sending a new one, which leaves both lecturers with a true story.
 *
 * The kind of project is fixed for the same reason: it decides the round, and
 * the round decides who may take the topic this becomes.
 */
export const UpdateProposalSchema = CreateProposalSchema.pick({
  title: true,
  description: true,
  expectedOutcomes: true,
})
  .partial()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: 'Không có thay đổi nào để lưu',
    },
  );

export class UpdateProposalDto extends createZodDto(UpdateProposalSchema) {}

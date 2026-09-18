import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddLabelsDto } from './label.dto';

describe('AddLabelsDto', () => {
  it.each(['中文', '项目-计划', '项目_2026', 'release-版本2', 'équipe'])(
    'accepts Unicode label %s',
    async (name) => {
      const dto = plainToInstance(AddLabelsDto, {
        pageId: '00000000-0000-4000-8000-000000000000',
        names: [name],
      });

      await expect(validate(dto)).resolves.toEqual([]);
    },
  );

  it('normalizes whitespace in Chinese labels', async () => {
    const dto = plainToInstance(AddLabelsDto, {
      pageId: '00000000-0000-4000-8000-000000000000',
      names: [' 项目 计划 '],
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.names).toEqual(['项目-计划']);
  });

  it.each(['~中文', '项目!', '😀'])(
    'rejects invalid label %s',
    async (name) => {
      const dto = plainToInstance(AddLabelsDto, {
        pageId: '00000000-0000-4000-8000-000000000000',
        names: [name],
      });

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'names')).toBe(true);
    },
  );
});

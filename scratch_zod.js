const { z } = require('zod');

const schema = z.object({
  landlordId: z.string().optional().transform(val => val === '' ? undefined : val).pipe(z.string().uuid().optional())
});

console.log(schema.safeParse({ landlordId: '' }));
console.log(schema.safeParse({ landlordId: 'Ea78iA8B3p' }));
console.log(schema.safeParse({ landlordId: '123e4567-e89b-12d3-a456-426614174000' }));
console.log(schema.safeParse({}));

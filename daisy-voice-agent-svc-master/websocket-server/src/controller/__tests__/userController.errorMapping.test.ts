import { UserController } from '@/controller/userController';
import { DuplicateUserError } from '@/errors/AuthErrors';
import { BadRequestError } from '@/errors/BadRequestError';
import { UserService } from '@/services/user/userService';
import { AuthenticatedRequest } from '@/types/customRequest';
import { Response } from 'express';

describe('UserController error mapping', () => {
  let controller: UserController;
  let mockUserService: jest.Mocked<
    Pick<UserService, 'createUser' | 'getUserById'>
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockUserService = {
      createUser: jest.fn(),
      getUserById: jest.fn(),
    };

    controller = new UserController(mockUserService as unknown as UserService);
  });

  it('maps DuplicateUserError to its own 409 status instead of a hardcoded 400', async () => {
    mockUserService.createUser.mockRejectedValue(
      new DuplicateUserError('jamie'),
    );

    const req = {
      body: { username: 'jamie', password: 'pw', role: 'admin' },
      user: { role: 'superadmin' },
    } as unknown as AuthenticatedRequest;

    await controller.createUser(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Username already exists: jamie' }),
    );
  });

  it('maps a BaseError subclass from getUserById to its statusCode instead of 500', async () => {
    mockUserService.getUserById.mockRejectedValue(
      new BadRequestError('Invalid user id format'),
    );

    const req = {
      params: { id: 'not-a-uuid' },
    } as unknown as AuthenticatedRequest;

    await controller.getUserById(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid user id format' }),
    );
  });
});

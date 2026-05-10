import { Injectable } from '@nestjs/common';

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
}

@Injectable()
export class ProjectsService {
  private projects: Project[] = [
    {
      id: '1',
      name: '示例项目',
      description: '这是一个示例小说项目',
      createdAt: new Date()
    }
  ];

  findAll() {
    return this.projects;
  }

  findOne(id: string) {
    return this.projects.find(p => p.id === id);
  }

  create(data: Partial<Project>) {
    const project = {
      id: String(Date.now()),
      name: data.name || '新项目',
      description: data.description || '',
      createdAt: new Date()
    };
    this.projects.push(project);
    return project;
  }
}

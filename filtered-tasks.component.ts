import { Component, OnInit, OnDestroy, Input, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { TaskService } from '../../services/task.service';
import { CategoryService } from '../../services/category.service';
import { SharedService } from '../../services/shared.service';
import { ActivatedRoute, Router } from '@angular/router';
import { User } from '../../interfaces/user';
import { SocketService } from '../../services/socket.service';

@Component({
  selector: 'app-filtered-tasks',
  templateUrl: './filtered-tasks.component.html',
  styleUrls: ['./filtered-tasks.component.scss']
})
export class FilteredTasksComponent implements OnInit, OnDestroy {
  @Input('bagName') bagName: string;
  @Output('filteredTasks') tasks: any = new EventEmitter();
    
  filteredTasks;
  teamId;
  routeParams;
  sub;
  sub2;
  subsViewMode;
  loading: boolean;
  viewMode;
  categories;
  menu;
  category;
  orderBy;
  user;
  searchText;
  currentUser: User;
  onlyOtherUserTutorials: boolean;

  constructor(private taskService: TaskService,
    private sharedService: SharedService,
    private route: ActivatedRoute,
    private router: Router,
    private categoryService: CategoryService,
    private socketService: SocketService,
    private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnInit() {
    this.currentUser = this.sharedService.getUser();
    this.teamId = this.sharedService.getTeam()._id;
    this.viewMode = this.sharedService.getItem('view_mode') || 'cards';

    this.subsViewMode = this.sharedService.viewModeChange.subscribe((viewMode) => {
      // if(viewMode=== 'kanban'){
      //   return;
      // }
      this.viewMode = viewMode;
    });

    this.sub = this.route.params.subscribe((params) => {
      this.routeParams = params;
      if (params['menu'] && params['category'] || params['orderBy']) {
        let change;
        if (this.menu !== params['menu']) {
          change = true;
        }
        this.menu = (params['menu'] === 'new') ? 'group' : params['menu'];
        this.category = params['category'];
        this.orderBy = params['orderBy'];
        this.user = params['user'] || null;
        this.searchText = params['searchText'] || null;
        this.getAll(change);
      }
    });

    this.sub2 = this.sharedService.restartRequest.subscribe((categoryChange) => {
      // if (!categoryChange) {
      this.getAll(true);
      // }

    });
    
    this.socketService.socket.on('add_new_task', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('edit_task', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('delete_task', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('add_comment', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('mark_task_todo', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('mark_task_in_progress', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
    this.socketService.socket.on('mark_task_completed', (data) => {
      if(this.currentUser._id !== data.initiator) {
        this.getAll(true);
      }
    });
  }

  getTasks(): Promise<any> {
    const optionalFilters = {
      user: this.user,
      searchText: this.searchText
    };
    return this.taskService.getTasks(this.teamId, this.menu, this.category, optionalFilters);
  }

  getCategories(): Promise<any> {
    return this.categoryService.getCategories(this.teamId);
  }

  getAll(change) {
    this.filteredTasks = null;
    const promises = [this.getTasks(), this.getCategories()];
    this.loading = true;
    Promise.all(promises)
      .then((res) => {
        this.filteredTasks = this.removeOtherUserTutorials(res[0].tasks);
        this.tasks.emit(this.filteredTasks); 
        this.categories = res[1];
        this.populateCategoryColors();
        this.loading = false;
        // getTaskCountPerCategory is called only if menu mode has changed,
        // not for each category change: SM
        if (change) {
          this.getTaskCountPerCategory(res[0].modeTasks);
        }
      })

      .catch((err) => {
        this.loading = false;
      });
  }

  populateCategoryColors() {
    this.filteredTasks.forEach((task, index) => {
      const foundCategory = this.categories.find((category) => {
        return task.category && task.category._id === category._id;
      });
      if (foundCategory) {
        this.filteredTasks[index].category.color = foundCategory.color;
      }
    });
  }

  getTaskCountPerCategory(modeTasks) {
    const counts = {
      totalCount: modeTasks.filter((task) => { return !task.isTutorialTask; }).length,
      perCategory: {}
    };
    modeTasks.forEach((task) => {
      if (task.category && task.category._id && !task.isTutorialTask) {
        if (!counts.perCategory.hasOwnProperty(task.category._id)) {
          counts.perCategory[task.category._id] = 1;
        } else {
          counts.perCategory[task.category._id] += 1;
        }
      }
    });
    this.sharedService.emitTaskQuantity(counts);
  }

  removeOtherUserTutorials(tasks) {
    return tasks.filter((task) => {
      return !task.isTutorialTask || (task.isTutorialTask && task.owner._id === this.currentUser._id);
    });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.sub2.unsubscribe();
    this.subsViewMode.unsubscribe();
  }
}
